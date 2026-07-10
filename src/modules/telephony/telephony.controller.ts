import { Controller, Post, Body, HttpCode, HttpStatus, Header } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventBusService, DomainEventType } from '../../common/event-bus/event-bus.service';
import { StructuredLogger } from '../../common/logger/logger.service';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class InboundCallDto {
  @IsString()
  @IsNotEmpty()
  CallSid!: string;

  @IsString()
  @IsNotEmpty()
  From!: string;

  @IsString()
  @IsNotEmpty()
  To!: string;

  @IsOptional()
  @IsString()
  CustomField?: string;
}

export class StatusCallbackDto {
  @IsString()
  @IsNotEmpty()
  CallSid!: string;

  @IsString()
  @IsNotEmpty()
  Status!: string;
}

@Controller('telephony')
export class TelephonyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly logger: StructuredLogger
  ) {
    this.logger.setContext('TelephonyController');
  }

  // ─── EXOTEL ────────────────────────────────────────────────────────

  @Post('exotel/inbound')
  @HttpCode(HttpStatus.OK)
  async handleExotelInboundCall(@Body() body: InboundCallDto) {
    this.logger.log(`[Exotel] Received inbound call request. Call SID: ${body.CallSid} from: ${body.From}`);

    const assistant = await this.prisma.assistant.findFirst();
    const organization = await this.prisma.organization.findFirst();

    if (!assistant || !organization) {
      this.logger.warn('[Exotel] Inbound call rejected: No assistants or organizations configured in database.');
      return { status: 'rejected', reason: 'No configured assistant.' };
    }

    const session = await this.prisma.callSession.create({
      data: {
        status: 'INITIATED',
        callerNumber: body.From,
        receiverNumber: body.To,
        providerCallId: body.CallSid,
        providerName: 'exotel',
        assistantId: assistant.id,
        organizationId: organization.id,
      },
    });

    this.logger.log(`[Exotel] Created new call session database entry: ${session.id}`);

    this.eventBus.publish({
      type: DomainEventType.CallStarted,
      organizationId: organization.id,
      callSessionId: session.id,
      payload: { callerNumber: body.From, receiverNumber: body.To },
    });

    const voiceGatewayUrl = process.env.VOICE_GATEWAY_WS_URL || 'ws://localhost:3000/v1/voice-stream';
    return {
      status: 'success',
      instruction: {
        action: 'stream',
        url: `${voiceGatewayUrl}?callSessionId=${session.id}&token=bypass-auth`,
      },
    };
  }

  @Post('exotel/status')
  @HttpCode(HttpStatus.OK)
  async handleExotelStatusCallback(@Body() body: StatusCallbackDto) {
    this.logger.log(`[Exotel] Received call status callback. SID: ${body.CallSid}, Status: ${body.Status}`);
    return this.updateCallStatus(body.CallSid, body.Status);
  }

  // ─── TWILIO ────────────────────────────────────────────────────────

  @Post('twilio/inbound')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  async handleTwilioInboundCall(@Body() body: InboundCallDto) {
    this.logger.log(`[Twilio] Received inbound call request. Call SID: ${body.CallSid} from: ${body.From}`);

    const assistant = await this.prisma.assistant.findFirst();
    const organization = await this.prisma.organization.findFirst();

    if (!assistant || !organization) {
      this.logger.warn('[Twilio] Inbound call rejected: No assistants or organizations configured.');
      return `<Response><Reject /></Response>`;
    }

    const session = await this.prisma.callSession.create({
      data: {
        status: 'INITIATED',
        callerNumber: body.From,
        receiverNumber: body.To,
        providerCallId: body.CallSid,
        providerName: 'twilio',
        assistantId: assistant.id,
        organizationId: organization.id,
      },
    });

    this.logger.log(`[Twilio] Created new call session database entry: ${session.id}`);

    this.eventBus.publish({
      type: DomainEventType.CallStarted,
      organizationId: organization.id,
      callSessionId: session.id,
      payload: { callerNumber: body.From, receiverNumber: body.To },
    });

    const voiceGatewayUrl = process.env.VOICE_GATEWAY_WS_URL || 'ws://localhost:3000/v1/voice-stream';
    const websocketUrlWithParams = `${voiceGatewayUrl}?callSessionId=${session.id}&token=bypass-auth`;

    // Twilio Media Streams XML TwiML Instruction response
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${websocketUrlWithParams}" />
  </Connect>
</Response>`;
  }

  @Post('twilio/status')
  @HttpCode(HttpStatus.OK)
  async handleTwilioStatusCallback(@Body() body: StatusCallbackDto) {
    this.logger.log(`[Twilio] Received call status callback. SID: ${body.CallSid}, Status: ${body.Status}`);
    return this.updateCallStatus(body.CallSid, body.Status);
  }

  // ─── PRIVATE HELPERS ───────────────────────────────────────────────

  private async updateCallStatus(providerCallId: string, status: string) {
    const callSession = await this.prisma.callSession.findUnique({
      where: { providerCallId },
    });

    if (!callSession) {
      this.logger.warn(`Received status update for unregistered Call SID: ${providerCallId}`);
      return { success: false };
    }

    let nextStatus = callSession.status;
    let endedAt: Date | undefined;

    // Twilio status list: queued, ringing, in-progress, completed, busy, failed, no-answer, canceled
    // Exotel status list: completed, failed, busy, in-progress, ringing etc.
    if (
      status === 'completed' ||
      status === 'failed' ||
      status === 'busy' ||
      status === 'no-answer' ||
      status === 'canceled'
    ) {
      nextStatus = 'COMPLETED';
      endedAt = new Date();
    } else if (status === 'in-progress') {
      nextStatus = 'ANSWERED';
    }

    await this.prisma.callSession.update({
      where: { id: callSession.id },
      data: {
        status: nextStatus,
        endedAt,
      },
    });

    return { success: true };
  }
}

import { Controller, Post, Body, HttpCode, HttpStatus, Header, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventBusService, DomainEventType } from '../../common/event-bus/event-bus.service';
import { StructuredLogger } from '../../common/logger/logger.service';
import { IsString, IsNotEmpty, IsOptional, Allow } from 'class-validator';
import { TwilioSignatureGuard } from './guards/twilio-signature.guard';

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

  // Allow any additional Twilio/Exotel properties without validation errors
  [key: string]: any;
}

export class StatusCallbackDto {
  @IsString()
  @IsNotEmpty()
  CallSid!: string;

  @IsOptional()
  @IsString()
  Status?: string;

  // Twilio sends 'CallStatus' instead of 'Status'
  @IsOptional()
  @IsString()
  CallStatus?: string;

  // Allow any additional Twilio properties without validation errors
  [key: string]: any;
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

    const assistant = await this.prisma.assistant.findFirst({
      include: {
        aiProviderConfig: true,
      },
    });
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
        provider: assistant.aiProviderConfig?.providerName || 'openai',
      },
    };
  }

  @Post('exotel/status')
  @HttpCode(HttpStatus.OK)
  async handleExotelStatusCallback(@Body() body: StatusCallbackDto) {
    const status = body.Status || body.CallStatus || 'unknown';
    this.logger.log(`[Exotel] Received call status callback. SID: ${body.CallSid}, Status: ${status}`);
    return this.updateCallStatus(body.CallSid, status);
  }

  // ─── TWILIO ────────────────────────────────────────────────────────

  @Post('twilio/inbound')
  @UseGuards(TwilioSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  async handleTwilioInboundCall(@Body() body: any) {
    if (!body || !body.CallSid || !body.From || !body.To) {
      this.logger.warn('[Twilio] Inbound call rejected: Missing CallSid, From, or To in request body.');
      return `<Response><Reject /></Response>`;
    }

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
    const twilioGatewayUrl = voiceGatewayUrl.replace('/v1/voice-stream', '/v1/telephony/twilio/stream');

    // Twilio Media Streams XML TwiML Instruction response
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${twilioGatewayUrl}">
      <Parameter name="callSessionId" value="${session.id}" />
    </Stream>
  </Connect>
</Response>`;
  }

  @Post('twilio/status')
  @UseGuards(TwilioSignatureGuard)
  @HttpCode(HttpStatus.OK)
  async handleTwilioStatusCallback(@Body() body: any) {
    if (!body || !body.CallSid) {
      this.logger.warn('[Twilio] Status callback rejected: Missing CallSid in request body.');
      return { status: 'error', reason: 'Missing CallSid' };
    }
    const status = body.Status || body.CallStatus || 'unknown';
    this.logger.log(`[Twilio] Received call status callback. SID: ${body.CallSid}, Status: ${status}`);
    return this.updateCallStatus(body.CallSid, status);
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

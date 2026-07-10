import { Injectable } from '@nestjs/common';
import { TelephonyProvider, CallInitiateDto, TelephonyCallInfo } from './interfaces/telephony.interface';
import { ExotelProvider } from './providers/exotel.provider';
import { TwilioProvider } from './providers/twilio.provider';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StructuredLogger } from '../../common/logger/logger.service';

@Injectable()
export class TelephonyService implements TelephonyProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exotelProvider: ExotelProvider,
    private readonly twilioProvider: TwilioProvider,
    private readonly logger: StructuredLogger
  ) {
    this.logger.setContext('TelephonyService');
  }

  async initiateCall(dto: CallInitiateDto): Promise<TelephonyCallInfo> {
    const isIndia = dto.receiverNumber.startsWith('+91');
    const provider = isIndia ? this.exotelProvider : this.twilioProvider;
    const providerName = isIndia ? 'exotel' : 'twilio';

    this.logger.log(`Routing outbound call to ${dto.receiverNumber} via carrier: ${providerName}`);
    return await provider.initiateCall(dto);
  }

  async hangupCall(providerCallId: string): Promise<void> {
    const session = await this.prisma.callSession.findUnique({
      where: { providerCallId },
    });

    const providerName = session?.providerName || 'exotel';
    this.logger.log(`Routing hangup action for call ${providerCallId} to carrier: ${providerName}`);
    const provider = providerName === 'twilio' ? this.twilioProvider : this.exotelProvider;
    await provider.hangupCall(providerCallId);
  }

  async transferCall(providerCallId: string, destinationNumber: string): Promise<void> {
    const session = await this.prisma.callSession.findUnique({
      where: { providerCallId },
    });

    const providerName = session?.providerName || 'exotel';
    this.logger.log(`Routing transfer action for call ${providerCallId} to carrier: ${providerName}`);
    const provider = providerName === 'twilio' ? this.twilioProvider : this.exotelProvider;
    await provider.transferCall(providerCallId, destinationNumber);
  }

  async playAudio(providerCallId: string, audioUrl: string): Promise<void> {
    const session = await this.prisma.callSession.findUnique({
      where: { providerCallId },
    });

    const providerName = session?.providerName || 'exotel';
    this.logger.log(`Routing playAudio action for call ${providerCallId} to carrier: ${providerName}`);
    const provider = providerName === 'twilio' ? this.twilioProvider : this.exotelProvider;
    await provider.playAudio(providerCallId, audioUrl);
  }
}

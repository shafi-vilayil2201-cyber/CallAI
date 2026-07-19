import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelephonyProvider, CallInitiateDto, TelephonyCallInfo } from '../interfaces/telephony.interface';
import { StructuredLogger } from '../../../common/logger/logger.service';

@Injectable()
export class ExotelProvider implements TelephonyProvider {
  private readonly apiKey: string;
  private readonly apiToken: string;
  private readonly accountSid: string;
  private readonly subdomain: string;
  private readonly callerId: string; // Registered Exotel virtual number

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: StructuredLogger
  ) {
    this.logger.setContext('ExotelProvider');
    this.apiKey = this.configService.get<string>('EXOTEL_API_KEY', '');
    this.apiToken = this.configService.get<string>('EXOTEL_API_TOKEN', '');
    this.accountSid = this.configService.get<string>('EXOTEL_ACCOUNT_SID', '');
    this.subdomain = this.configService.get<string>('EXOTEL_SUBDOMAIN', 'api.exotel.com');
    this.callerId = this.configService.get<string>('EXOTEL_CALLER_ID', '');
  }

  async initiateCall(dto: CallInitiateDto): Promise<TelephonyCallInfo> {
    this.logger.log(`Initiating outbound call from ${dto.callerNumber} to ${dto.receiverNumber}`);

    const url = `https://${this.subdomain}/v1/Accounts/${this.accountSid}/Calls/connect.json`;
    const basicAuth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');

    const params = new URLSearchParams({
      From: dto.receiverNumber, // Exotel connects 'From' (receiver) first, then binds 'To'
      To: this.callerId,        // Virtual number
      CallerId: this.callerId,
      StatusCallback: `${this.configService.get<string>('API_PUBLIC_URL')}/v1/telephony/exotel/status`,
      CustomField: dto.assistantId,
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Exotel request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const providerCallId = data?.Call?.Sid || data?.Call?.ParentCallSid;

      if (!providerCallId) {
        throw new Error(`Invalid response structure from Exotel: ${JSON.stringify(data)}`);
      }

      return {
        providerCallId,
        status: data?.Call?.Status || 'initiated',
      };
    } catch (error) {
      this.logger.error('Failed to connect call via Exotel API', error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  async hangupCall(providerCallId: string): Promise<void> {
    this.logger.log(`Terminating active call session: ${providerCallId}`);
    const url = `https://${this.subdomain}/v1/Accounts/${this.accountSid}/Calls/${providerCallId}.json`;
    const basicAuth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ Status: 'completed' }),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error(`Exotel hangup action failed for call ${providerCallId}: ${err}`);
      }
    } catch (error) {
      this.logger.error(`Error executing hangup call for ${providerCallId}`, error instanceof Error ? error.stack : undefined);
    }
  }

  async transferCall(providerCallId: string, destinationNumber: string): Promise<void> {
    this.logger.log(`Transferring call ${providerCallId} to destination: ${destinationNumber}`);
    // Exotel call transfer logic (e.g. updating the active leg / connecting a new leg)
    const url = `https://${this.subdomain}/v1/Accounts/${this.accountSid}/Calls/${providerCallId}/modify.json`;
    const basicAuth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          Location: 'Agent',
          Destination: destinationNumber,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Exotel transfer failed: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      this.logger.error(`Error executing transfer for call ${providerCallId}`, error instanceof Error ? error.stack : undefined);
    }
  }

  async playAudio(providerCallId: string, audioUrl: string): Promise<void> {
    this.logger.log(`Playing pre-recorded audio snippet to call ${providerCallId}: ${audioUrl}`);
    // Exotel audio playback mechanism using IVR/Play URL updates
  }
}

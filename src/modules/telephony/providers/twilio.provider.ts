import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelephonyProvider, CallInitiateDto, TelephonyCallInfo } from '../interfaces/telephony.interface';
import { StructuredLogger } from '../../../common/logger/logger.service';

@Injectable()
export class TwilioProvider implements TelephonyProvider {
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly twilioNumber: string;
  private readonly subdomain: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: StructuredLogger
  ) {
    this.logger.setContext('TwilioProvider');
    this.accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID', 'mock-sid');
    this.authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN', 'mock-token');
    this.twilioNumber = this.configService.get<string>('TWILIO_NUMBER', '+1234567890');
    this.subdomain = this.configService.get<string>('TWILIO_SUBDOMAIN', 'api.twilio.com');
  }

  async initiateCall(dto: CallInitiateDto): Promise<TelephonyCallInfo> {
    this.logger.log(`Initiating Twilio call to: ${dto.receiverNumber}`);

    const url = `https://${this.subdomain}/2010-04-01/Accounts/${this.accountSid}/Calls.json`;
    const authHeader = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    const params = new URLSearchParams({
      From: this.twilioNumber,
      To: dto.receiverNumber,
      Url: `${this.configService.get<string>('API_PUBLIC_URL') || 'http://localhost:3000'}/v1/telephony/twilio/inbound`,
      StatusCallback: `${this.configService.get<string>('API_PUBLIC_URL') || 'http://localhost:3000'}/v1/telephony/twilio/status`,
      StatusCallbackEvent: 'completed',
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Twilio request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const providerCallId = data?.sid;

      if (!providerCallId) {
        throw new Error(`Invalid response structure from Twilio: ${JSON.stringify(data)}`);
      }

      return {
        providerCallId,
        status: data?.status || 'queued',
      };
    } catch (error) {
      this.logger.error('Failed to connect call via Twilio API', error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  async hangupCall(providerCallId: string): Promise<void> {
    this.logger.log(`Terminating active Twilio call: ${providerCallId}`);
    const url = `https://${this.subdomain}/2010-04-01/Accounts/${this.accountSid}/Calls/${providerCallId}.json`;
    const authHeader = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ Status: 'completed' }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Twilio call update failed: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      this.logger.error(`Error executing hangup call on Twilio: ${providerCallId}`, error instanceof Error ? error.stack : undefined);
    }
  }

  async transferCall(providerCallId: string, destinationNumber: string): Promise<void> {
    this.logger.log(`Transferring Twilio call ${providerCallId} to ${destinationNumber}`);
    const url = `https://${this.subdomain}/2010-04-01/Accounts/${this.accountSid}/Calls/${providerCallId}.json`;
    const authHeader = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          Url: `${this.configService.get<string>('API_PUBLIC_URL') || 'http://localhost:3000'}/v1/telephony/twilio/transfer?to=${destinationNumber}`,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Twilio call transfer update failed: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      this.logger.error(`Error executing transfer on Twilio for call ${providerCallId}`, error instanceof Error ? error.stack : undefined);
    }
  }

  async playAudio(providerCallId: string, audioUrl: string): Promise<void> {
    this.logger.log(`Playing audio via Twilio call ${providerCallId}: ${audioUrl}`);
    const url = `https://${this.subdomain}/2010-04-01/Accounts/${this.accountSid}/Calls/${providerCallId}.json`;
    const authHeader = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          Url: `${this.configService.get<string>('API_PUBLIC_URL') || 'http://localhost:3000'}/v1/telephony/twilio/play?url=${encodeURIComponent(audioUrl)}`,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Twilio call play audio update failed: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      this.logger.error(`Error executing playAudio on Twilio for call ${providerCallId}`, error instanceof Error ? error.stack : undefined);
    }
  }
}

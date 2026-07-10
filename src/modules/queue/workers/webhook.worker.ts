import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { StructuredLogger } from '../../../common/logger/logger.service';

@Processor('webhook-dispatch')
@Injectable()
export class WebhookWorker extends WorkerHost {
  constructor(private readonly logger: StructuredLogger) {
    super();
    this.logger.setContext('WebhookWorker');
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { webhookId, url, secret, event } = job.data;
    this.logger.log(`Processing webhook dispatch job: ${job.id} for webhook ${webhookId} to ${url}`);

    if (!url || !secret || !event) {
      this.logger.warn(`Invalid job details for webhook ${webhookId}: url, secret, and event must be provided`);
      return { success: false, reason: 'Invalid parameters' };
    }

    const payloadString = JSON.stringify(event);
    
    // Compute HMAC SHA256 signature
    const signature = crypto
      .createHmac('sha256', secret)
      .update(payloadString)
      .digest('hex');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CallAI-Signature': signature,
          'User-Agent': 'CallAI-Webhook-Dispatcher/1.0',
        },
        body: payloadString,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Webhook target responded with status ${response.status}: ${errorText}`);
      }

      this.logger.log(`Webhook successfully delivered to ${url}. Status: ${response.status}`);
      return { success: true, status: response.status };
    } catch (err) {
      this.logger.error(`Webhook delivery failed to ${url}`, err instanceof Error ? err.stack : undefined);
      throw err; // Trigger BullMQ retry
    }
  }
}

import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventBusService, DomainEventType } from '../../common/event-bus/event-bus.service';
import { StructuredLogger } from '../../common/logger/logger.service';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class QueueEventSubscriber implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBusService,
    private readonly prisma: PrismaService,
    @InjectQueue('call-analytics') private readonly analyticsQueue: Queue,
    @InjectQueue('recording-upload') private readonly recordingQueue: Queue,
    @InjectQueue('webhook-dispatch') private readonly webhookQueue: Queue,
    private readonly logger: StructuredLogger
  ) {
    this.logger.setContext('QueueEventSubscriber');
  }

  onModuleInit() {
    this.logger.log('Initializing Event subscriber for queue dispatching...');
    
    // Listen for CallEnded events to enqueue analytics and recording tasks
    this.eventBus.ofEvent(DomainEventType.CallEnded).subscribe({
      next: async (event) => {
        const { callSessionId } = event;
        this.logger.log(`Received CallEnded event for session ${callSessionId}. Enqueuing background jobs.`);

        try {
          // 1. Enqueue analytics job
          await this.analyticsQueue.add('process-analytics', { callSessionId });
          this.logger.log(`Enqueued process-analytics job for session ${callSessionId}`);

          // 2. Enqueue recording upload job
          const mockAudioBuffer = Buffer.from('mock-audio-content-for-recording').toString('base64');
          await this.recordingQueue.add('upload-recording', { 
            callSessionId,
            rawAudioBase64: mockAudioBuffer 
          });
          this.logger.log(`Enqueued upload-recording job for session ${callSessionId}`);
        } catch (error) {
          this.logger.error(`Failed to enqueue background jobs for session ${callSessionId}`, error instanceof Error ? error.stack : undefined);
        }
      }
    });

    // Listen for all events to check for tenant webhooks
    this.eventBus.getEvents$().subscribe({
      next: async (event) => {
        try {
          // Query active webhooks for the tenant matching this event type
          const webhooks = await this.prisma.webhook.findMany({
            where: {
              organizationId: event.organizationId,
              isActive: true,
              eventTypes: {
                has: event.type,
              },
            },
          });

          for (const webhook of webhooks) {
            await this.webhookQueue.add('dispatch-webhook', {
              webhookId: webhook.id,
              url: webhook.url,
              secret: webhook.secret,
              event,
            });
            this.logger.log(`Enqueued webhook dispatch for session ${event.callSessionId} event type ${event.type} to ${webhook.url}`);
          }
        } catch (error) {
          this.logger.error(`Failed to process webhook events for session ${event.callSessionId}`, error instanceof Error ? error.stack : undefined);
        }
      }
    });
  }
}

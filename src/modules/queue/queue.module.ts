import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AnalyticsWorker } from './workers/analytics.worker';
import { RecordingWorker } from './workers/recording.worker';
import { WebhookWorker } from './workers/webhook.worker';
import { BillingModule } from '../billing/billing.module';
import { MemoryModule } from '../memory/memory.module';
import { QueueEventSubscriber } from './queue-event-subscriber.service';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: 'call-analytics' },
      { name: 'recording-upload' },
      { name: 'webhook-dispatch' }
    ),
    BillingModule,
    MemoryModule,
  ],
  providers: [
    AnalyticsWorker,
    RecordingWorker,
    WebhookWorker,
    QueueEventSubscriber,
  ],
  exports: [
    BullModule,
  ],
})
export class QueueModule {}

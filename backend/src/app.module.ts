import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { envValidationSchema } from './common/config/env.validation';

// Shared Global Modules
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './common/health/health.module';

// Feature Modules
import { TelephonyModule } from './modules/telephony/telephony.module';
import { AiOrchestratorModule } from './modules/ai-orchestrator/ai-orchestrator.module';
import { ConversationEngineModule } from './modules/conversation-engine/conversation-engine.module';
import { VoiceGatewayModule } from './modules/voice-gateway/voice-gateway.module';
import { BillingModule } from './modules/billing/billing.module';
import { MemoryModule } from './modules/memory/memory.module';
import { ToolEngineModule } from './modules/tool-engine/tool-engine.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { LatencyModule } from './modules/latency/latency.module';
import { QueueModule } from './modules/queue/queue.module';

// REST API Resource Modules
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { AssistantsModule } from './modules/assistants/assistants.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { CallSessionsModule } from './modules/call-sessions/call-sessions.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),

    // Global Rate Limiting: 100 requests per minute
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),

    // Core Infrastructures
    CommonModule,
    AuthModule,
    HealthModule,
    QueueModule,

    // Domain Gateway Modules
    TelephonyModule,
    VoiceGatewayModule,

    // Core Domain Engine Modules
    ConversationEngineModule,
    AiOrchestratorModule,
    MemoryModule,
    ToolEngineModule,
    BillingModule,
    FeatureFlagsModule,
    LatencyModule,

    // REST API Tenant/Resource Modules
    OrganizationsModule,
    AssistantsModule,
    ApiKeysModule,
    CallSessionsModule,
    WebhooksModule,
  ],
  providers: [
    // Global Rate Limiting Guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

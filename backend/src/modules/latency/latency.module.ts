import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LatencyMetricsStore } from './latency-metrics.store';
import { LatencyService } from './latency.service';
import { DecisionEngineService } from './decision-engine.service';
import { LatencyController } from './latency.controller';

/**
 * LatencyModule
 *
 * Encapsulates the Latency-Aware Intelligence Layer.
 * Import this module into any feature module that needs latency tracking
 * or strategy resolution (e.g., ConversationEngineModule).
 *
 * Exported services:
 *   - LatencyService        — tracking lifecycle + observability snapshots
 *   - DecisionEngineService — strategy resolution + enriched snapshots
 *
 * LatencyMetricsStore is intentionally NOT exported — it is an internal
 * implementation detail. Consumers always interact through LatencyService.
 *
 * HTTP endpoints (JWT-protected):
 *   GET /v1/debug/latency/:callSessionId         — full snapshot
 *   GET /v1/debug/latency/:callSessionId/history — raw turn history
 */
@Module({
  imports: [ConfigModule],
  controllers: [LatencyController],
  providers: [LatencyMetricsStore, LatencyService, DecisionEngineService],
  exports: [LatencyService, DecisionEngineService],
})
export class LatencyModule {}


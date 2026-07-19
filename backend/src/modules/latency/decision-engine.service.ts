import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StructuredLogger } from '../../common/logger/logger.service';
import { LatencyMetricsStore } from './latency-metrics.store';
import { LatencyService } from './latency.service';
import { LatencyStrategy, LatencyThresholds, SessionSnapshot } from './latency.types';

@Injectable()
export class DecisionEngineService {
  private readonly thresholds: LatencyThresholds;

  /**
   * Refinement 1 — Strategy change logging:
   * Tracks the last resolved strategy per session so we can detect and log
   * tier transitions.
   */
  private readonly previousStrategies = new Map<string, LatencyStrategy>();

  constructor(
    private readonly store: LatencyMetricsStore,
    private readonly latencyService: LatencyService,
    private readonly configService: ConfigService,
    private readonly logger: StructuredLogger,
  ) {
    this.logger.setContext('DecisionEngineService');

    this.thresholds = {
      fullMs:           this.configService.get<number>('LATENCY_THRESHOLD_FULL_MS', 400),
      shortMs:          this.configService.get<number>('LATENCY_THRESHOLD_SHORT_MS', 800),
      spikeMultiplier:  this.configService.get<number>('LATENCY_SPIKE_MULTIPLIER', 2.0),
      spikeMinAvgMs:    this.configService.get<number>('LATENCY_SPIKE_MIN_AVG_MS', 200),
      fillerCooldownMs: this.configService.get<number>('LATENCY_FILLER_COOLDOWN_MS', 3000),
    };

    this.logger.log(
      `Thresholds loaded — FULL<${this.thresholds.fullMs}ms, ` +
      `SHORT<${this.thresholds.shortMs}ms, ` +
      `spike=${this.thresholds.spikeMultiplier}x@${this.thresholds.spikeMinAvgMs}ms, ` +
      `fillerCooldown=${this.thresholds.fillerCooldownMs}ms`,
    );
  }

  /**
   * Derives the optimal response strategy for a call session.
   *
   * @param callSessionId Active call session identifier
   * @returns LatencyStrategy — 'FULL' | 'SHORT' | 'FILLER'
   */
  async getStrategy(callSessionId: string): Promise<LatencyStrategy> {
    const metrics = await this.store.getMetrics(callSessionId);

    // No data yet (first turn of the session) — assume healthy
    if (!metrics || metrics.recentLatencies.length === 0) {
      return 'FULL';
    }

    // Refinement 2 — Cold start bias protection:
    if (metrics.recentLatencies.length < 3) {
      this.logger.debug(
        `Cold start guard active for ${callSessionId}: ` +
        `only ${metrics.recentLatencies.length}/3 samples — returning FULL.`,
      );
      return 'FULL';
    }

    const { avgLatency, lastLatency } = metrics;
    const { fullMs, shortMs, spikeMultiplier, spikeMinAvgMs } = this.thresholds;

    // ── Base strategy from rolling average ──────────────────────────────
    let strategy: LatencyStrategy;

    if (avgLatency < fullMs) {
      strategy = 'FULL';
    } else if (avgLatency < shortMs) {
      strategy = 'SHORT';
    } else {
      strategy = 'FILLER';
    }

    // ── Spike detection: escalate one tier on sudden latency surge ─────
    if (
      avgLatency > spikeMinAvgMs &&
      lastLatency > spikeMultiplier * avgLatency
    ) {
      strategy = this.escalate(strategy);
      this.logger.debug(
        `Spike detected for ${callSessionId}: ` +
        `lastLatency=${lastLatency}ms > ${spikeMultiplier}x avg=${avgLatency}ms. ` +
        `Strategy escalated to ${strategy}.`,
      );
    }

    // Refinement 1 — Strategy change logging:
    const previousStrategy = this.previousStrategies.get(callSessionId);
    if (previousStrategy !== strategy) {
      this.logger.debug({
        event: 'strategy_change',
        callSessionId,
        from: previousStrategy ?? 'none',
        to: strategy,
        avgLatency,
        lastLatency,
        sampleCount: metrics.recentLatencies.length,
      });
    }
    this.previousStrategies.set(callSessionId, strategy);

    this.logger.debug(
      `Strategy resolved for ${callSessionId}: ${strategy} ` +
      `(avg=${avgLatency}ms, last=${lastLatency}ms)`,
    );

    return strategy;
  }

  /**
   * Returns the filler cooldown from the loaded thresholds.
   */
  getFillerCooldownMs(): number {
    return this.thresholds.fillerCooldownMs;
  }

  /**
   * Returns a complete session snapshot enriched with strategy resolution.
   */
  async getSessionSnapshot(callSessionId: string): Promise<SessionSnapshot> {
    const strategy = await this.getStrategy(callSessionId);
    return this.latencyService.getSessionSnapshot(callSessionId, strategy);
  }

  /**
   * Cleans up strategy memory for a terminated session.
   */
  clearSession(callSessionId: string): void {
    this.previousStrategies.delete(callSessionId);
  }

  private escalate(strategy: LatencyStrategy): LatencyStrategy {
    switch (strategy) {
      case 'FULL': return 'SHORT';
      case 'SHORT': return 'FILLER';
      case 'FILLER': return 'FILLER';
    }
  }
}

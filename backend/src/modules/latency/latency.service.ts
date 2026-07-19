import { Injectable } from '@nestjs/common';
import { StructuredLogger } from '../../common/logger/logger.service';
import { LatencyMetricsStore } from './latency-metrics.store';
import { LatencyMetrics, SessionSnapshot, LatencyStrategy } from './latency.types';

@Injectable()
export class LatencyService {
  /**
   * Hard upper bound for any recorded latency value (Refinement 3).
   * Values above this indicate infrastructure anomalies, not real AI latency.
   * Clamping prevents a single timeout from corrupting the rolling average.
   */
  static readonly MAX_LATENCY_CAP_MS = 5_000;

  /**
   * Tracks in-flight request start timestamps keyed by callSessionId.
   * Populated by markAIRequestStart, consumed by markAIResponseEnd.
   * Remains in-memory since in-flight requests are local to the websocket handler instance.
   */
  private readonly pendingStart = new Map<string, number>();

  constructor(
    private readonly store: LatencyMetricsStore,
    private readonly logger: StructuredLogger,
  ) {
    this.logger.setContext('LatencyService');
  }

  // ─── Session Lifecycle ────────────────────────────────────────────────────

  /**
   * Initialises latency tracking for a new call session.
   * Must be called once at session start before any mark* methods.
   */
  async startTracking(callSessionId: string): Promise<void> {
    await this.store.initSession(callSessionId);
    this.logger.debug(`Latency tracking started: ${callSessionId}`);
  }

  /**
   * Cleans up all state for a terminated session.
   * Cancels the TTL handle and removes the session from the store.
   */
  async stopTracking(callSessionId: string): Promise<void> {
    this.pendingStart.delete(callSessionId);
    await this.store.deleteSession(callSessionId);
    this.logger.debug(`Latency tracking stopped: ${callSessionId}`);
  }

  // ─── Latency Measurement ──────────────────────────────────────────────────

  /**
   * Records the timestamp at which the AI model was invoked.
   * Called from onResponseStarted callback — synchronous, ~1μs.
   */
  markAIRequestStart(callSessionId: string): void {
    this.pendingStart.set(callSessionId, Date.now());
  }

  /**
   * Computes AI response latency and records it in the store.
   * Called from onResponseCompleted callback — asynchronous, non-blocking.
   *
   * Refinement 3 — Hard safety cap:
   * Latency is clamped to MAX_LATENCY_CAP_MS (5000ms) before storage.
   * Prevents a single network outage or provider timeout from permanently
   * distorting the rolling average and triggering erroneous strategy escalations.
   */
  async markAIResponseEnd(callSessionId: string): Promise<void> {
    const startTime = this.pendingStart.get(callSessionId);
    if (startTime === undefined) return;

    const measured = Date.now() - startTime;
    // Clamp to 5 s — any value above this is likely an infrastructure anomaly,
    // not a representative AI response time.
    const latencyMs = Math.min(measured, LatencyService.MAX_LATENCY_CAP_MS);
    this.pendingStart.delete(callSessionId);
    await this.store.recordLatency(callSessionId, latencyMs);

    if (measured !== latencyMs) {
      this.logger.warn(
        `Latency clamped for session ${callSessionId}: ` +
        `measured=${measured}ms → capped at ${LatencyService.MAX_LATENCY_CAP_MS}ms`,
      );
    }

    this.logger.debug(`AI response latency: ${latencyMs}ms (session: ${callSessionId})`);
  }

  /**
   * Adds tool execution time on top of the last recorded latency.
   * Useful when a tool call was the dominant contributor to total turn latency.
   * Applies the same 5000ms safety cap as markAIResponseEnd.
   */
  async markToolExecution(callSessionId: string, durationMs: number): Promise<void> {
    const metrics = await this.store.getMetrics(callSessionId);
    if (!metrics) return;

    // Accumulate tool time into the most recent latency sample, capped for safety
    const adjusted = Math.min(
      metrics.lastLatency + durationMs,
      LatencyService.MAX_LATENCY_CAP_MS,
    );
    await this.store.recordLatency(callSessionId, adjusted);
    this.logger.debug(
      `Tool execution time ${durationMs}ms accumulated. Adjusted latency: ${adjusted}ms`,
    );
  }

  // ─── Metric Accessors ─────────────────────────────────────────────────────

  /**
   * Returns the most recent AI response latency in ms, or 0 if not yet available.
   */
  async getCurrentLatency(callSessionId: string): Promise<number> {
    const metrics = await this.store.getMetrics(callSessionId);
    return metrics?.lastLatency ?? 0;
  }

  /**
   * Returns the full latency history for a session (up to last 10 turns).
   */
  async getLatencyHistory(callSessionId: string): Promise<number[]> {
    const metrics = await this.store.getMetrics(callSessionId);
    return metrics?.recentLatencies ?? [];
  }

  /**
   * Returns full latency metrics or null if session not found.
   */
  async getMetrics(callSessionId: string): Promise<LatencyMetrics | null> {
    return this.store.getMetrics(callSessionId);
  }

  // ─── Observability (Improvement 1) ───────────────────────────────────────

  /**
   * Returns a complete observability snapshot for a session.
   * Includes raw metrics and is enriched with the resolved strategy by DecisionEngineService.
   *
   * Intended for:
   *   - Admin dashboards
   *   - Debug endpoints
   *   - Future analytics pipelines
   *
   * @param strategy Pass-through of the resolved strategy (computed by DecisionEngineService)
   */
  async getSessionSnapshot(
    callSessionId: string,
    strategy: LatencyStrategy,
  ): Promise<SessionSnapshot> {
    const state = await this.store.getState(callSessionId);

    if (!state) {
      return {
        callSessionId,
        currentLatency: 0,
        avgLatency: 0,
        strategy,
        history: [],
        lastUpdated: 0,
      };
    }

    return {
      callSessionId,
      currentLatency: state.lastLatency,
      avgLatency: state.avgLatency,
      strategy,
      history: [...state.recentLatencies],
      lastUpdated: state.lastUpdated,
    };
  }

  // ─── FILLER Rate Limiting (Improvement 4) ────────────────────────────────

  /**
   * Returns true if a FILLER response may be sent right now.
   * Guards against audio spam when latency stays persistently high.
   *
   * @param cooldownMs Minimum gap between FILLER emissions in milliseconds
   */
  async shouldSendFiller(callSessionId: string, cooldownMs: number): Promise<boolean> {
    const state = await this.store.getState(callSessionId);
    if (!state) return false;

    const elapsed = Date.now() - state.lastFillerTimestamp;
    return elapsed >= cooldownMs;
  }

  /**
   * Records that a FILLER response was just sent.
   * Must be called immediately after emitting a filler to reset the cooldown.
   */
  async recordFillerSent(callSessionId: string): Promise<void> {
    await this.store.setLastFillerTimestamp(callSessionId, Date.now());
  }
}

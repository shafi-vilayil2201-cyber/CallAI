/**
 * Latency-Aware Intelligence Layer — Type Definitions
 *
 * Strategy tiers determine how the AI responds under network/processing pressure.
 * FULL   → Normal, unconstrained response
 * SHORT  → One-sentence response instruction appended to prompt
 * FILLER → Immediate bridging phrase sent before the AI processes
 */
export type LatencyStrategy = 'FULL' | 'SHORT' | 'FILLER';

/**
 * Public snapshot of latency metrics for a given call session.
 * Safe to expose via observability endpoints.
 */
export interface LatencyMetrics {
  /** All recorded latency values (most recent N turns) */
  recentLatencies: number[];
  /** Rolling average in milliseconds */
  avgLatency: number;
  /** Most recent single turn latency in milliseconds */
  lastLatency: number;
}

/**
 * Extended snapshot including the derived strategy — used for observability and admin UI.
 */
export interface SessionSnapshot {
  callSessionId: string;
  currentLatency: number;
  avgLatency: number;
  strategy: LatencyStrategy;
  history: number[];
  lastUpdated: number;
}

/**
 * Configurable thresholds for the decision engine.
 * Injected via ConfigService to allow A/B testing and runtime tuning.
 */
export interface LatencyThresholds {
  /** Below this → FULL strategy (ms) */
  fullMs: number;
  /** Between fullMs and shortMs → SHORT strategy (ms) */
  shortMs: number;
  /** Above shortMs → FILLER strategy (ms) */
  /** Spike detection: triggers tier escalation when lastLatency > spikeMultiplier * avg */
  spikeMultiplier: number;
  /** Minimum avg before spike detection activates (avoids false positives at session start) */
  spikeMinAvgMs: number;
  /** Minimum gap between FILLER responses to prevent audio spam (ms) */
  fillerCooldownMs: number;
}

/**
 * Internal per-session state stored in LatencyMetricsStore.
 * Not exposed externally.
 */
export interface SessionLatencyState {
  recentLatencies: number[];
  avgLatency: number;
  lastLatency: number;
  lastUpdated: number;
  /** Timestamp of the most recent FILLER emission — used for rate limiting */
  lastFillerTimestamp: number;
  /** Safety TTL cleanup handle — only needed for in-memory fallback */
  ttlHandle?: ReturnType<typeof setTimeout>;
}

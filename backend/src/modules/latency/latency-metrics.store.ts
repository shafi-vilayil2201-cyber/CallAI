import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { StructuredLogger } from '../../common/logger/logger.service';
import { SessionLatencyState, LatencyMetrics } from './latency.types';

/** Maximum number of recent latency samples to retain per session */
const MAX_HISTORY_SIZE = 10;

/** Safety TTL: auto-clean sessions in Redis after 30 minutes (1800 seconds) */
const SESSION_TTL_SECONDS = 30 * 60;

@Injectable()
export class LatencyMetricsStore {
  private readonly redisClient: Redis;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: StructuredLogger,
  ) {
    this.logger.setContext('LatencyMetricsStore');

    // Connection pooling to Redis cluster/instance
    this.redisClient = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
  }

  private getRedisKey(callSessionId: string): string {
    return `latency:session:${callSessionId}`;
  }

  /**
   * Initialises a new session entry in Redis with a 30-minute safety TTL.
   */
  async initSession(callSessionId: string): Promise<void> {
    const key = this.getRedisKey(callSessionId);
    const exists = await this.redisClient.exists(key);
    if (exists) {
      return; // Already initialized
    }

    const state: SessionLatencyState = {
      recentLatencies: [],
      avgLatency: 0,
      lastLatency: 0,
      lastUpdated: Date.now(),
      lastFillerTimestamp: 0,
    };

    await this.redisClient.set(
      key,
      JSON.stringify(state),
      'EX',
      SESSION_TTL_SECONDS,
    );
    this.logger.debug(`Session initialised in Redis: ${callSessionId}`);
  }

  /**
   * Records a new latency sample for a session.
   * Maintains a fixed-size ring buffer and recomputes the rolling average inline.
   */
  async recordLatency(callSessionId: string, latencyMs: number): Promise<void> {
    const key = this.getRedisKey(callSessionId);
    const data = await this.redisClient.get(key);
    if (!data) return;

    const state: SessionLatencyState = JSON.parse(data);

    // Push new sample, evict oldest if at capacity
    state.recentLatencies.push(latencyMs);
    if (state.recentLatencies.length > MAX_HISTORY_SIZE) {
      state.recentLatencies.shift();
    }

    // Recompute rolling average
    const sum = state.recentLatencies.reduce((acc, v) => acc + v, 0);
    state.avgLatency = Math.round(sum / state.recentLatencies.length);
    state.lastLatency = latencyMs;
    state.lastUpdated = Date.now();

    await this.redisClient.set(
      key,
      JSON.stringify(state),
      'EX',
      SESSION_TTL_SECONDS,
    );
  }

  /**
   * Returns a public-safe metrics snapshot (no internal handles).
   * Returns null if the session does not exist.
   */
  async getMetrics(callSessionId: string): Promise<LatencyMetrics | null> {
    const key = this.getRedisKey(callSessionId);
    const data = await this.redisClient.get(key);
    if (!data) return null;

    const state: SessionLatencyState = JSON.parse(data);

    return {
      recentLatencies: [...state.recentLatencies],
      avgLatency: state.avgLatency,
      lastLatency: state.lastLatency,
    };
  }

  /**
   * Returns the full internal state — used by LatencyService for filler cooldown checks.
   * Returns null if the session does not exist.
   */
  async getState(callSessionId: string): Promise<SessionLatencyState | null> {
    const key = this.getRedisKey(callSessionId);
    const data = await this.redisClient.get(key);
    if (!data) return null;

    return JSON.parse(data) as SessionLatencyState;
  }

  /**
   * Updates the last filler emission timestamp for rate-limiting.
   */
  async setLastFillerTimestamp(
    callSessionId: string,
    timestamp: number,
  ): Promise<void> {
    const key = this.getRedisKey(callSessionId);
    const data = await this.redisClient.get(key);
    if (!data) return;

    const state: SessionLatencyState = JSON.parse(data);
    state.lastFillerTimestamp = timestamp;

    await this.redisClient.set(
      key,
      JSON.stringify(state),
      'EX',
      SESSION_TTL_SECONDS,
    );
  }

  /**
   * Removes a session entry and cancels its pending TTL.
   */
  async deleteSession(callSessionId: string): Promise<void> {
    const key = this.getRedisKey(callSessionId);
    await this.redisClient.del(key);
    this.logger.debug(`Session deleted from Redis: ${callSessionId}`);
  }

  /** Returns total number of tracked sessions in Redis using scanning */
  async getActiveSessionCount(): Promise<number> {
    const keys = await this.redisClient.keys('latency:session:*');
    return keys.length;
  }

  /** Helper to close connection handle during shutdown/testing */
  async closeConnection(): Promise<void> {
    try {
      await this.redisClient.quit();
    } catch {
      await this.redisClient.disconnect();
    }
  }
}

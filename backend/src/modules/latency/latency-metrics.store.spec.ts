import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LatencyMetricsStore } from './latency-metrics.store';
import { StructuredLogger } from '../../common/logger/logger.service';

const mockStoreMap = new Map<string, string>();

jest.mock('ioredis', () => {
  return {
    default: jest.fn().mockImplementation(() => {
      return {
        exists: jest.fn().mockImplementation(async (key) => mockStoreMap.has(key) ? 1 : 0),
        set: jest.fn().mockImplementation(async (key, val, mode, ttl) => {
          mockStoreMap.set(key, val);
          return 'OK';
        }),
        get: jest.fn().mockImplementation(async (key) => mockStoreMap.get(key) || null),
        del: jest.fn().mockImplementation(async (key) => {
          mockStoreMap.delete(key);
          return 1;
        }),
        keys: jest.fn().mockImplementation(async (pattern) => Array.from(mockStoreMap.keys())),
        quit: jest.fn().mockResolvedValue('OK'),
        disconnect: jest.fn().mockResolvedValue('OK'),
      };
    }),
  };
});

const mockLogger = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, defaultValue?: any) => defaultValue),
};

describe('LatencyMetricsStore', () => {
  let store: LatencyMetricsStore;

  beforeEach(async () => {
    mockStoreMap.clear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LatencyMetricsStore,
        { provide: StructuredLogger, useValue: mockLogger },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    store = module.get<LatencyMetricsStore>(LatencyMetricsStore);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await store.closeConnection();
  });

  // ─── initSession ──────────────────────────────────────────────────────────

  describe('initSession', () => {
    it('should create a new session entry', async () => {
      await store.initSession('sess-1');
      expect(await store.getMetrics('sess-1')).not.toBeNull();
    });

    it('should initialise session with zero metrics', async () => {
      await store.initSession('sess-1');
      const metrics = (await store.getMetrics('sess-1'))!;
      expect(metrics.recentLatencies).toEqual([]);
      expect(metrics.avgLatency).toBe(0);
      expect(metrics.lastLatency).toBe(0);
    });

    it('should be idempotent — calling twice does not reset existing data', async () => {
      await store.initSession('sess-1');
      await store.recordLatency('sess-1', 300);
      await store.initSession('sess-1'); // second call — should be a no-op
      expect((await store.getMetrics('sess-1'))!.lastLatency).toBe(300);
    });
  });

  // ─── recordLatency ────────────────────────────────────────────────────────

  describe('recordLatency', () => {
    it('should record a latency value and update lastLatency', async () => {
      await store.initSession('sess-1');
      await store.recordLatency('sess-1', 250);
      expect((await store.getMetrics('sess-1'))!.lastLatency).toBe(250);
    });

    it('should correctly compute the rolling average', async () => {
      await store.initSession('sess-1');
      await store.recordLatency('sess-1', 200);
      await store.recordLatency('sess-1', 400);
      await store.recordLatency('sess-1', 600);
      // avg = (200 + 400 + 600) / 3 = 400
      expect((await store.getMetrics('sess-1'))!.avgLatency).toBe(400);
    });

    it('should maintain a ring buffer of max 10 entries', async () => {
      await store.initSession('sess-1');
      for (let i = 1; i <= 12; i++) {
        await store.recordLatency('sess-1', i * 100);
      }
      const { recentLatencies } = (await store.getMetrics('sess-1'))!;
      expect(recentLatencies).toHaveLength(10);
      // Oldest (100, 200) evicted — newest 10 remain
      expect(recentLatencies[0]).toBe(300);
      expect(recentLatencies[9]).toBe(1200);
    });

    it('should update the rolling average after ring buffer eviction', async () => {
      await store.initSession('sess-1');
      // Fill 10 entries with 100ms each
      for (let i = 0; i < 10; i++) {
        await store.recordLatency('sess-1', 100);
      }
      // Push an 11th that evicts the first 100
      await store.recordLatency('sess-1', 1000);
      const { avgLatency, recentLatencies } = (await store.getMetrics('sess-1'))!;
      // 9 × 100 + 1 × 1000 = 1900 / 10 = 190
      const expectedAvg = Math.round(
        recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length,
      );
      expect(avgLatency).toBe(expectedAvg);
    });

    it('should be a no-op for an unknown session', async () => {
      await expect(store.recordLatency('nonexistent', 500)).resolves.not.toThrow();
    });
  });

  // ─── getMetrics ───────────────────────────────────────────────────────────

  describe('getMetrics', () => {
    it('should return null for a session that was never initialised', async () => {
      expect(await store.getMetrics('ghost')).toBeNull();
    });

    it('should return a copy of recentLatencies (not a reference)', async () => {
      await store.initSession('sess-1');
      await store.recordLatency('sess-1', 300);
      const metrics = (await store.getMetrics('sess-1'))!;
      metrics.recentLatencies.push(9999); // mutate local copy
      // Original in store must be unchanged
      expect((await store.getMetrics('sess-1'))!.recentLatencies).not.toContain(9999);
    });
  });

  // ─── setLastFillerTimestamp / filler cooldown ─────────────────────────────

  describe('setLastFillerTimestamp', () => {
    it('should update lastFillerTimestamp on the session state', async () => {
      await store.initSession('sess-1');
      const ts = Date.now();
      await store.setLastFillerTimestamp('sess-1', ts);
      expect((await store.getState('sess-1'))!.lastFillerTimestamp).toBe(ts);
    });

    it('should be a no-op for an unknown session', async () => {
      await expect(store.setLastFillerTimestamp('ghost', Date.now())).resolves.not.toThrow();
    });
  });

  // ─── deleteSession ────────────────────────────────────────────────────────

  describe('deleteSession', () => {
    it('should remove the session and make getMetrics return null', async () => {
      await store.initSession('sess-1');
      await store.deleteSession('sess-1');
      expect(await store.getMetrics('sess-1')).toBeNull();
    });

    it('should be idempotent — deleting a non-existent session is safe', async () => {
      await expect(store.deleteSession('ghost')).resolves.not.toThrow();
    });
  });

  // ─── getActiveSessionCount ────────────────────────────────────────────────

  describe('getActiveSessionCount', () => {
    it('should track the number of active sessions correctly', async () => {
      expect(await store.getActiveSessionCount()).toBe(0);
      await store.initSession('s1');
      await store.initSession('s2');
      expect(await store.getActiveSessionCount()).toBe(2);
      await store.deleteSession('s1');
      expect(await store.getActiveSessionCount()).toBe(1);
    });
  });
});

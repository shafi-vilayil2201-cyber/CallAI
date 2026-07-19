import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DecisionEngineService } from './decision-engine.service';
import { LatencyMetricsStore } from './latency-metrics.store';
import { LatencyService } from './latency.service';
import { StructuredLogger } from '../../common/logger/logger.service';
import { LatencyMetrics } from './latency.types';

// ─── Shared mock setup ────────────────────────────────────────────────────────

const mockStore = {
  getMetrics: jest.fn(),
};

const mockLatencyService = {
  getSessionSnapshot: jest.fn(),
};

/** Default thresholds matching env.validation defaults */
const mockConfigService = {
  get: jest.fn((key: string, defaultVal: number) => {
    const config: Record<string, number> = {
      LATENCY_THRESHOLD_FULL_MS:  400,
      LATENCY_THRESHOLD_SHORT_MS: 800,
      LATENCY_SPIKE_MULTIPLIER:   2.0,
      LATENCY_SPIKE_MIN_AVG_MS:   200,
      LATENCY_FILLER_COOLDOWN_MS: 3000,
    };
    return config[key] ?? defaultVal;
  }),
};

const mockLogger = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeMetrics(
  latencies: number[],
  overrides: Partial<LatencyMetrics> = {},
): LatencyMetrics {
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;
  return {
    recentLatencies: latencies,
    avgLatency,
    lastLatency: latencies[latencies.length - 1] ?? 0,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DecisionEngineService', () => {
  let service: DecisionEngineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecisionEngineService,
        { provide: LatencyMetricsStore, useValue: mockStore },
        { provide: LatencyService,      useValue: mockLatencyService },
        { provide: ConfigService,       useValue: mockConfigService },
        { provide: StructuredLogger,    useValue: mockLogger },
      ],
    }).compile();

    service = module.get<DecisionEngineService>(DecisionEngineService);
    jest.clearAllMocks();
    // Re-apply config mock after clearAllMocks resets it
    mockConfigService.get.mockImplementation((key: string, defaultVal: number) => {
      const config: Record<string, number> = {
        LATENCY_THRESHOLD_FULL_MS:  400,
        LATENCY_THRESHOLD_SHORT_MS: 800,
        LATENCY_SPIKE_MULTIPLIER:   2.0,
        LATENCY_SPIKE_MIN_AVG_MS:   200,
        LATENCY_FILLER_COOLDOWN_MS: 3000,
      };
      return config[key] ?? defaultVal;
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── Cold start guard (Refinement 2) ───────────────────────────────────────

  describe('cold start guard', () => {
    it('should return FULL when no metrics exist yet', async () => {
      mockStore.getMetrics.mockResolvedValue(null);
      expect(await service.getStrategy('sess-1')).toBe('FULL');
    });

    it('should return FULL when sample count is 0', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([]));
      expect(await service.getStrategy('sess-1')).toBe('FULL');
    });

    it('should return FULL when sample count is 1 (below minimum of 3)', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([500])); // single slow turn
      expect(await service.getStrategy('sess-1')).toBe('FULL');
    });

    it('should return FULL when sample count is 2 (below minimum of 3)', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([500, 600]));
      expect(await service.getStrategy('sess-1')).toBe('FULL');
    });

    it('should leave the cold start guard once 3 samples exist', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([500, 600, 700]));
      expect(await service.getStrategy('sess-1')).toBe('SHORT'); // avg 600 >= 400ms FULL ceiling
    });
  });

  // ─── Base strategy resolving rules ──────────────────────────────────────────

  describe('base strategy from rolling average', () => {
    it('should return FULL when avg < 400ms', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([300, 310, 320]));
      expect(await service.getStrategy('sess-1')).toBe('FULL');
    });

    it('should return FULL exactly at 399ms average', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([399, 399, 399]));
      expect(await service.getStrategy('sess-1')).toBe('FULL');
    });

    it('should return SHORT when avg is exactly 400ms', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([400, 400, 400]));
      expect(await service.getStrategy('sess-1')).toBe('SHORT');
    });

    it('should return SHORT when avg is between 400ms and 799ms', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([500, 550, 600]));
      expect(await service.getStrategy('sess-1')).toBe('SHORT');
    });

    it('should return SHORT exactly at 799ms average', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([799, 799, 799]));
      expect(await service.getStrategy('sess-1')).toBe('SHORT');
    });

    it('should return FILLER when avg is exactly 800ms', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([800, 800, 800]));
      expect(await service.getStrategy('sess-1')).toBe('FILLER');
    });

    it('should return FILLER when avg exceeds 800ms', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([900, 950, 1000]));
      expect(await service.getStrategy('sess-1')).toBe('FILLER');
    });
  });

  // ─── Spike detection (Improvement 3) ───────────────────────────────────────

  describe('spike detection', () => {
    it('should escalate FULL → SHORT on spike when avg > spikeMinAvgMs', async () => {
      // avg is 300ms (FULL tier), but last turn spikes to 650ms (> 2.0x avg)
      mockStore.getMetrics.mockResolvedValue(makeMetrics([125, 125, 650], { avgLatency: 300, lastLatency: 650 }));
      expect(await service.getStrategy('sess-1')).toBe('SHORT');
    });

    it('should escalate SHORT → FILLER on spike', async () => {
      // avg is 500ms (SHORT tier), last turn spikes to 1100ms (> 2.0x avg)
      mockStore.getMetrics.mockResolvedValue(makeMetrics([200, 200, 1100], { avgLatency: 500, lastLatency: 1100 }));
      expect(await service.getStrategy('sess-1')).toBe('FILLER');
    });

    it('should keep FILLER at ceiling — does not escalate beyond FILLER', async () => {
      // avg is 900ms (FILLER tier), last turn spikes to 2000ms
      mockStore.getMetrics.mockResolvedValue(makeMetrics([350, 350, 2000], { avgLatency: 900, lastLatency: 2000 }));
      expect(await service.getStrategy('sess-1')).toBe('FILLER');
    });

    it('should NOT trigger spike detection when avg <= spikeMinAvgMs (200ms)', async () => {
      // avg is 150ms, last turn spikes to 320ms (> 2.0x avg).
      // Since avg <= 200ms, spike detection is suppressed to prevent false positives.
      mockStore.getMetrics.mockResolvedValue(makeMetrics([65, 65, 320], { avgLatency: 150, lastLatency: 320 }));
      expect(await service.getStrategy('sess-1')).toBe('FULL');
    });

    it('should NOT trigger spike when lastLatency <= 2× avg (no spike)', async () => {
      // avg is 300ms, last turn is 500ms (not a 2x spike)
      mockStore.getMetrics.mockResolvedValue(makeMetrics([200, 200, 500], { avgLatency: 300, lastLatency: 500 }));
      expect(await service.getStrategy('sess-1')).toBe('FULL');
    });

    it('should trigger spike exactly at the 2× boundary', async () => {
      // avg is 300ms, last turn is 601ms (> 2.0x avg)
      mockStore.getMetrics.mockResolvedValue(makeMetrics([149, 150, 601], { avgLatency: 300, lastLatency: 601 }));
      expect(await service.getStrategy('sess-1')).toBe('SHORT');
    });
  });

  // ─── Strategy change logging ───────────────────────────────────────────────

  describe('strategy change logging', () => {
    it('should emit a debug log when strategy changes from FULL to SHORT', async () => {
      // Turn 1 resolves to FULL (3 samples avg < 400)
      mockStore.getMetrics.mockResolvedValue(makeMetrics([300, 300, 300]));
      await service.getStrategy('sess-change');

      // Turn 2 resolves to SHORT (avg >= 400)
      jest.clearAllMocks();
      mockStore.getMetrics.mockResolvedValue(makeMetrics([500, 500, 500]));
      await service.getStrategy('sess-change');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'strategy_change',
          from: 'FULL',
          to: 'SHORT',
        }),
      );
    });

    it('should NOT emit a change log when strategy stays the same', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([300, 300, 300]));
      
      await service.getStrategy('sess-stable');
      jest.clearAllMocks();
      await service.getStrategy('sess-stable');

      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'strategy_change',
        }),
      );
    });

    it('should log from: "none" on the very first strategy transition', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([300, 300, 300]));
      await service.getStrategy('sess-first-log');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'strategy_change',
          from: 'none',
          to: 'FULL',
        }),
      );
    });
  });

  // ─── clearSession ──────────────────────────────────────────────────────────

  describe('clearSession', () => {
    it('should clear previousStrategy so next call reports "none" as previous', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([300, 300, 300]));
      
      await service.getStrategy('sess-clear'); // resolved strategy cached as FULL
      service.clearSession('sess-clear');      // strategy memory purged
      
      jest.clearAllMocks();
      await service.getStrategy('sess-clear'); // resolves strategy again
      
      // Should log transition from "none" instead of "FULL"
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'strategy_change',
          from: 'none',
          to: 'FULL',
        }),
      );
    });

    it('should be safe to call on an unknown session', () => {
      expect(() => service.clearSession('nonexistent')).not.toThrow();
    });
  });

  // ─── getFillerCooldownMs ───────────────────────────────────────────────────

  describe('getFillerCooldownMs', () => {
    it('should return the configured cooldown (3000ms default)', () => {
      expect(service.getFillerCooldownMs()).toBe(3000);
    });
  });

  // ─── getSessionSnapshot ────────────────────────────────────────────────────

  describe('getSessionSnapshot', () => {
    it('should delegate to latencyService.getSessionSnapshot with resolved strategy', async () => {
      mockStore.getMetrics.mockResolvedValue(makeMetrics([300, 300, 300]));
      mockLatencyService.getSessionSnapshot.mockResolvedValue({
        callSessionId: 'sess-1',
        currentLatency: 300,
        avgLatency: 300,
        strategy: 'FULL',
        history: [300, 300, 300],
        lastUpdated: Date.now(),
      });

      const snap = await service.getSessionSnapshot('sess-1');

      expect(mockLatencyService.getSessionSnapshot).toHaveBeenCalledWith(
        'sess-1',
        'FULL', // strategy resolved before passing to latencyService
      );
      expect(snap.strategy).toBe('FULL');
    });
  });
});

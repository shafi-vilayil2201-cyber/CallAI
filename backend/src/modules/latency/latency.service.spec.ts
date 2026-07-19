import { Test, TestingModule } from '@nestjs/testing';
import { LatencyService } from './latency.service';
import { LatencyMetricsStore } from './latency-metrics.store';
import { StructuredLogger } from '../../common/logger/logger.service';

const mockStore = {
  initSession: jest.fn().mockResolvedValue(undefined),
  deleteSession: jest.fn().mockResolvedValue(undefined),
  recordLatency: jest.fn().mockResolvedValue(undefined),
  getMetrics: jest.fn(),
  getState: jest.fn(),
  setLastFillerTimestamp: jest.fn().mockResolvedValue(undefined),
};

const mockLogger = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

describe('LatencyService', () => {
  let service: LatencyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LatencyService,
        { provide: LatencyMetricsStore, useValue: mockStore },
        { provide: StructuredLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<LatencyService>(LatencyService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── MAX_LATENCY_CAP_MS constant ──────────────────────────────────────────

  describe('MAX_LATENCY_CAP_MS', () => {
    it('should be 5000ms', () => {
      expect(LatencyService.MAX_LATENCY_CAP_MS).toBe(5_000);
    });
  });

  // ─── startTracking / stopTracking ─────────────────────────────────────────

  describe('startTracking', () => {
    it('should call store.initSession', async () => {
      await service.startTracking('sess-1');
      expect(mockStore.initSession).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('stopTracking', () => {
    it('should call store.deleteSession', async () => {
      await service.stopTracking('sess-1');
      expect(mockStore.deleteSession).toHaveBeenCalledWith('sess-1');
    });

    it('should clear any pending start timestamp for the session', async () => {
      // Simulate an in-flight request that was never completed
      service.markAIRequestStart('sess-1');
      await service.stopTracking('sess-1');
      // No pending start left — markAIResponseEnd should be a no-op
      await service.markAIResponseEnd('sess-1');
      expect(mockStore.recordLatency).not.toHaveBeenCalled();
    });
  });

  // ─── markAIRequestStart / markAIResponseEnd ───────────────────────────────

  describe('markAIRequestStart + markAIResponseEnd', () => {
    it('should record a positive latency in the store', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(1000);

      service.markAIRequestStart('sess-1');
      jest.setSystemTime(1350); // 350ms later

      await service.markAIResponseEnd('sess-1');

      expect(mockStore.recordLatency).toHaveBeenCalledWith('sess-1', 350);
      jest.useRealTimers();
    });

    it('should clamp measured latency to MAX_LATENCY_CAP_MS (5000ms)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(0);

      service.markAIRequestStart('sess-1');
      jest.setSystemTime(10_000); // 10s — well above the 5000ms cap

      await service.markAIResponseEnd('sess-1');

      expect(mockStore.recordLatency).toHaveBeenCalledWith('sess-1', 5000);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Latency clamped for session sess-1'),
      );
      jest.useRealTimers();
    });

    it('should be a no-op if markAIRequestStart was never called', async () => {
      await service.markAIResponseEnd('sess-ghost');
      expect(mockStore.recordLatency).not.toHaveBeenCalled();
    });

    it('should not record the same request twice (pendingStart is cleared)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(1000);
      service.markAIRequestStart('sess-1');
      jest.setSystemTime(1200);

      await service.markAIResponseEnd('sess-1'); // first completion
      expect(mockStore.recordLatency).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();
      await service.markAIResponseEnd('sess-1'); // double call — no pending start left
      expect(mockStore.recordLatency).not.toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  // ─── markToolExecution ───────────────────────────────────────────────────

  describe('markToolExecution', () => {
    it('should add tool duration to the last latency and record it', async () => {
      mockStore.getMetrics.mockResolvedValue({
        recentLatencies: [300],
        avgLatency: 300,
        lastLatency: 300,
      });

      await service.markToolExecution('sess-1', 150);

      // lastLatency 300 + 150 = 450
      expect(mockStore.recordLatency).toHaveBeenCalledWith('sess-1', 450);
    });

    it('should clamp the adjusted latency to MAX_LATENCY_CAP_MS', async () => {
      mockStore.getMetrics.mockResolvedValue({
        recentLatencies: [4800],
        avgLatency: 4800,
        lastLatency: 4800,
      });

      await service.markToolExecution('sess-1', 500); // adjusted would be 5300ms

      expect(mockStore.recordLatency).toHaveBeenCalledWith('sess-1', 5000);
    });

    it('should be a no-op if session has no metrics', async () => {
      mockStore.getMetrics.mockResolvedValue(null);

      await service.markToolExecution('sess-1', 100);

      expect(mockStore.recordLatency).not.toHaveBeenCalled();
    });
  });

  // ─── getCurrentLatency / getLatencyHistory ───────────────────────────────

  describe('getCurrentLatency', () => {
    it('should return lastLatency from store', async () => {
      mockStore.getMetrics.mockResolvedValue({
        lastLatency: 420,
      });
      const val = await service.getCurrentLatency('sess-1');
      expect(val).toBe(420);
    });

    it('should return 0 when session does not exist', async () => {
      mockStore.getMetrics.mockResolvedValue(null);
      const val = await service.getCurrentLatency('sess-ghost');
      expect(val).toBe(0);
    });
  });

  describe('getLatencyHistory', () => {
    it('should return recentLatencies from store', async () => {
      mockStore.getMetrics.mockResolvedValue({
        recentLatencies: [100, 200, 300],
      });
      const hist = await service.getLatencyHistory('sess-1');
      expect(hist).toEqual([100, 200, 300]);
    });

    it('should return empty array when session does not exist', async () => {
      mockStore.getMetrics.mockResolvedValue(null);
      const hist = await service.getLatencyHistory('sess-ghost');
      expect(hist).toEqual([]);
    });
  });

  // ─── getSessionSnapshot ──────────────────────────────────────────────────

  describe('getSessionSnapshot', () => {
    it('should return a complete snapshot when session exists', async () => {
      const now = Date.now();
      mockStore.getState.mockResolvedValue({
        recentLatencies: [200, 300],
        avgLatency: 250,
        lastLatency: 300,
        lastUpdated: now,
        lastFillerTimestamp: 0,
      });

      const snap = await service.getSessionSnapshot('sess-1', 'SHORT');

      expect(snap).toEqual({
        callSessionId: 'sess-1',
        currentLatency: 300,
        avgLatency: 250,
        strategy: 'SHORT',
        history: [200, 300],
        lastUpdated: now,
      });
    });

    it('should return zeroed snapshot when session does not exist', async () => {
      mockStore.getState.mockResolvedValue(null);

      const snap = await service.getSessionSnapshot('ghost', 'FULL');

      expect(snap.currentLatency).toBe(0);
      expect(snap.avgLatency).toBe(0);
      expect(snap.history).toEqual([]);
      expect(snap.strategy).toBe('FULL');
      expect(snap.lastUpdated).toBe(0);
    });
  });

  // ─── shouldSendFiller / recordFillerSent ─────────────────────────────────

  describe('shouldSendFiller', () => {
    it('should return true when enough time has passed since last filler', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(10_000);

      mockStore.getState.mockResolvedValue({
        lastFillerTimestamp: 6_000, // 4s ago
      });

      const canSend = await service.shouldSendFiller('sess-1', 3000); // 3s cooldown
      expect(canSend).toBe(true);
      jest.useRealTimers();
    });

    it('should return false when cooldown has not elapsed', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(10_000);

      mockStore.getState.mockResolvedValue({
        lastFillerTimestamp: 8_500, // 1.5s ago
      });

      const canSend = await service.shouldSendFiller('sess-1', 3000);
      expect(canSend).toBe(false);
      jest.useRealTimers();
    });

    it('should return true on first call (lastFillerTimestamp = 0)', async () => {
      mockStore.getState.mockResolvedValue({
        lastFillerTimestamp: 0,
      });

      const canSend = await service.shouldSendFiller('sess-1', 3000);
      expect(canSend).toBe(true);
    });

    it('should return false when session does not exist', async () => {
      mockStore.getState.mockResolvedValue(null);

      const canSend = await service.shouldSendFiller('sess-ghost', 3000);
      expect(canSend).toBe(false);
    });
  });

  describe('recordFillerSent', () => {
    it('should update lastFillerTimestamp via store', async () => {
      await service.recordFillerSent('sess-1');
      expect(mockStore.setLastFillerTimestamp).toHaveBeenCalledWith('sess-1', expect.any(Number));
    });
  });
});

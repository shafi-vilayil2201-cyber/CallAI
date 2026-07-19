import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LatencyController } from './latency.controller';
import { DecisionEngineService } from './decision-engine.service';
import { LatencyService } from './latency.service';
import { SessionSnapshot } from './latency.types';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const SESSION_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const mockSnapshot: SessionSnapshot = {
  callSessionId: SESSION_ID,
  currentLatency: 620,
  avgLatency: 510,
  strategy: 'SHORT',
  history: [420, 480, 510, 590, 620],
  lastUpdated: 1721321187432,
};

const mockDecisionEngine = {
  getSessionSnapshot: jest.fn(),
};

const mockLatencyService = {
  getMetrics: jest.fn(),
  getLatencyHistory: jest.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LatencyController', () => {
  let controller: LatencyController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LatencyController],
      providers: [
        { provide: DecisionEngineService, useValue: mockDecisionEngine },
        { provide: LatencyService,        useValue: mockLatencyService },
      ],
    }).compile();

    controller = module.get<LatencyController>(LatencyController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── GET /v1/debug/latency/:callSessionId ─────────────────────────────────

  describe('getSnapshot', () => {
    it('should return a SessionSnapshotResponseDto for an active session', async () => {
      mockLatencyService.getMetrics.mockResolvedValue({
        recentLatencies: [420, 480, 510, 590, 620],
        avgLatency: 510,
        lastLatency: 620,
      });
      mockDecisionEngine.getSessionSnapshot.mockResolvedValue(mockSnapshot);

      const result = await controller.getSnapshot(SESSION_ID);

      expect(result.callSessionId).toBe(SESSION_ID);
      expect(result.currentLatency).toBe(620);
      expect(result.avgLatency).toBe(510);
      expect(result.strategy).toBe('SHORT');
      expect(result.history).toEqual([420, 480, 510, 590, 620]);
      expect(result.sampleCount).toBe(5);
    });

    it('should include a human-readable lastUpdatedIso field', async () => {
      mockLatencyService.getMetrics.mockResolvedValue({ lastLatency: 300, avgLatency: 300, recentLatencies: [300] });
      mockDecisionEngine.getSessionSnapshot.mockResolvedValue(mockSnapshot);

      const result = await controller.getSnapshot(SESSION_ID);

      expect(result.lastUpdatedIso).toBe(
        new Date(mockSnapshot.lastUpdated).toISOString(),
      );
    });

    it('should throw NotFoundException when session is not tracked', async () => {
      mockLatencyService.getMetrics.mockResolvedValue(null);

      await expect(controller.getSnapshot('unknown-session')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException with a helpful message', async () => {
      mockLatencyService.getMetrics.mockResolvedValue(null);

      await expect(controller.getSnapshot('dead-session')).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('dead-session'),
        }),
      );
    });

    it('should call decisionEngine.getSessionSnapshot with the callSessionId', async () => {
      mockLatencyService.getMetrics.mockResolvedValue({ lastLatency: 200, avgLatency: 200, recentLatencies: [200] });
      mockDecisionEngine.getSessionSnapshot.mockResolvedValue(mockSnapshot);

      await controller.getSnapshot(SESSION_ID);

      expect(mockDecisionEngine.getSessionSnapshot).toHaveBeenCalledWith(SESSION_ID);
    });

    it('should correctly map all strategy values — FULL', async () => {
      mockLatencyService.getMetrics.mockResolvedValue({ lastLatency: 100, avgLatency: 100, recentLatencies: [100] });
      mockDecisionEngine.getSessionSnapshot.mockResolvedValue({
        ...mockSnapshot, strategy: 'FULL', currentLatency: 100, avgLatency: 100,
      });

      const result = await controller.getSnapshot(SESSION_ID);
      expect(result.strategy).toBe('FULL');
    });

    it('should correctly map all strategy values — FILLER', async () => {
      mockLatencyService.getMetrics.mockResolvedValue({ lastLatency: 900, avgLatency: 900, recentLatencies: [900] });
      mockDecisionEngine.getSessionSnapshot.mockResolvedValue({
        ...mockSnapshot, strategy: 'FILLER', currentLatency: 900, avgLatency: 900,
      });

      const result = await controller.getSnapshot(SESSION_ID);
      expect(result.strategy).toBe('FILLER');
    });

    it('should set lastUpdatedIso to empty string when lastUpdated is 0', async () => {
      mockLatencyService.getMetrics.mockResolvedValue({ lastLatency: 0, avgLatency: 0, recentLatencies: [] });
      mockDecisionEngine.getSessionSnapshot.mockResolvedValue({
        ...mockSnapshot, lastUpdated: 0,
      });

      const result = await controller.getSnapshot(SESSION_ID);
      expect(result.lastUpdatedIso).toBe('');
    });
  });

  // ─── GET /v1/debug/latency/:callSessionId/history ─────────────────────────

  describe('getHistory', () => {
    it('should return history array with sampleCount', async () => {
      const history = [200, 310, 280, 350];
      mockLatencyService.getLatencyHistory.mockResolvedValue(history);
      mockLatencyService.getMetrics.mockResolvedValue({
        recentLatencies: history,
        avgLatency: 285,
        lastLatency: 350,
      });

      const result = await controller.getHistory(SESSION_ID);

      expect(result.callSessionId).toBe(SESSION_ID);
      expect(result.history).toEqual(history);
      expect(result.sampleCount).toBe(4);
    });

    it('should return empty history with sampleCount 0 for a tracked session with no turns yet', async () => {
      mockLatencyService.getLatencyHistory.mockResolvedValue([]);
      // Session exists but no turns recorded yet
      mockLatencyService.getMetrics.mockResolvedValue({
        recentLatencies: [],
        avgLatency: 0,
        lastLatency: 0,
      });

      const result = await controller.getHistory(SESSION_ID);

      expect(result.history).toEqual([]);
      expect(result.sampleCount).toBe(0);
    });

    it('should throw NotFoundException when session is not tracked at all', async () => {
      mockLatencyService.getLatencyHistory.mockResolvedValue([]);
      mockLatencyService.getMetrics.mockResolvedValue(null);

      await expect(controller.getHistory('ghost-session')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should include callSessionId in the response', async () => {
      mockLatencyService.getLatencyHistory.mockResolvedValue([300, 400]);
      mockLatencyService.getMetrics.mockResolvedValue({ lastLatency: 400, avgLatency: 350, recentLatencies: [300, 400] });

      const result = await controller.getHistory(SESSION_ID);

      expect(result.callSessionId).toBe(SESSION_ID);
    });
  });
});

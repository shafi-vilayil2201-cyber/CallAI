import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { CostTrackerService } from '../../billing/cost-tracker.service';
import { MemoryService } from '../../memory/memory.service';
import { StructuredLogger } from '../../../common/logger/logger.service';

@Processor('call-analytics')
@Injectable()
export class AnalyticsWorker extends WorkerHost {
  constructor(
    private readonly costTracker: CostTrackerService,
    private readonly memoryService: MemoryService,
    private readonly logger: StructuredLogger
  ) {
    super();
    this.logger.setContext('AnalyticsWorker');
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { callSessionId } = job.data;
    this.logger.log(`Processing call analytics job: ${job.id} for session ${callSessionId}`);

    try {
      // 1. Calculate call costs (telephony, speech, LLM tokens)
      const costRecord = await this.costTracker.calculateSessionCost(callSessionId);

      // 2. Generate summary memory logs
      await this.memoryService.generateAndSaveSessionSummary(callSessionId);

      return {
        success: true,
        callSessionId,
        costRecordId: costRecord.id,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown analytics error';
      this.logger.error(`Analytics worker job failed for call ${callSessionId}`, err instanceof Error ? err.stack : undefined);
      throw new Error(`Job execution failed: ${msg}`);
    }
  }
}

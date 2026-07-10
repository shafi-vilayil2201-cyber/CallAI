import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StructuredLogger } from '../../common/logger/logger.service';

@Injectable()
export class CostTrackerService {
  // Configured pricing markers (GPT-4o Realtime rates, telephony margins, storage units)
  private readonly PRICE_PER_TELEPHONY_MIN = 0.02; // Exotel SIP outbound rate
  private readonly PRICE_PER_INPUT_TOKEN = 0.000005; // $5 per 1M tokens
  private readonly PRICE_PER_OUTPUT_TOKEN = 0.000020; // $20 per 1M tokens
  private readonly PRICE_PER_STORAGE_UNIT = 0.00005; // S3 storage charge estimate per call recording

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLogger
  ) {
    this.logger.setContext('CostTrackerService');
  }

  /**
   * Evaluates aggregate session usage and computes transactional costs
   */
  async calculateSessionCost(callSessionId: string): Promise<any> {
    this.logger.log(`Executing session cost calculations for call session: ${callSessionId}`);

    const callSession = await this.prisma.callSession.findUnique({
      where: { id: callSessionId },
      include: { messages: true },
    });

    if (!callSession) {
      throw new Error(`Call session ${callSessionId} not found in system.`);
    }

    const { startedAt, endedAt, messages, organizationId } = callSession;
    
    // 1. Calculate duration
    const callEnd = endedAt || new Date();
    const durationMs = callEnd.getTime() - startedAt.getTime();
    const durationMinutes = Math.ceil(durationMs / 1000 / 60);

    // 2. Aggregate Token Consumption
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    messages.forEach(msg => {
      // In realistic implementation, we split tokens. Standard default is split 40/60
      totalPromptTokens += Math.round(msg.tokenCount * 0.4);
      totalCompletionTokens += Math.round(msg.tokenCount * 0.6);
    });

    // 3. Compute costs
    const telephonyCost = durationMinutes * this.PRICE_PER_TELEPHONY_MIN;
    const llmCost = (totalPromptTokens * this.PRICE_PER_INPUT_TOKEN) + 
                    (totalCompletionTokens * this.PRICE_PER_OUTPUT_TOKEN);
    const speechCost = durationMinutes * 0.006; // Speech-to-text processing charge
    const voiceCost = durationMinutes * 0.015; // Text-to-speech rendering charge
    const storageCost = callSession.recordingUrl ? this.PRICE_PER_STORAGE_UNIT : 0.0;

    const totalCost = telephonyCost + llmCost + speechCost + voiceCost + storageCost;

    // Platform Markup: 50% margin
    const revenue = totalCost * 1.5;
    const margin = revenue - totalCost;

    this.logger.log({
      action: 'CostCalculationFinished',
      callSessionId,
      telephonyCost,
      llmCost,
      totalCost,
      revenue,
      margin,
    });

    // 4. Save to CallCost database table
    const costRecord = await this.prisma.callCost.upsert({
      where: { callSessionId },
      create: {
        callSessionId,
        telephonyCost,
        speechCost,
        llmCost,
        voiceCost,
        storageCost,
        totalCost,
        margin,
        revenue,
        currency: 'USD',
      },
      update: {
        telephonyCost,
        speechCost,
        llmCost,
        voiceCost,
        storageCost,
        totalCost,
        margin,
        revenue,
      },
    });

    // 5. Append records to general Multi-Tenant Usage ledger for billing integration
    await this.prisma.usage.createMany({
      data: [
        {
          organizationId,
          callSessionId,
          resourceType: 'TELEPHONY_MINUTES',
          quantity: durationMinutes,
          cost: telephonyCost,
        },
        {
          organizationId,
          callSessionId,
          resourceType: 'LLM_TOKENS',
          quantity: totalPromptTokens + totalCompletionTokens,
          cost: llmCost,
        },
      ],
    });

    // Deduct from organization billing profile balance (prepaid setup check)
    const billing = await this.prisma.billing.findUnique({
      where: { organizationId },
    });

    if (billing) {
      await this.prisma.billing.update({
        where: { organizationId },
        data: {
          balance: {
            decrement: revenue,
          },
        },
      });
    }

    return costRecord;
  }
}

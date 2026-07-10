import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StructuredLogger } from '../../common/logger/logger.service';

@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLogger
  ) {
    this.logger.setContext('MemoryService');
  }

  /**
   * Fetches context/summaries from previous conversations for a given caller phone number
   */
  async retrieveLongTermContext(organizationId: string, callerNumber: string): Promise<string> {
    this.logger.log(`Retrieving historical memory for caller: ${callerNumber}`);
    
    // Fetch last 3 completed calls from this caller to retrieve summaries/context
    const recentSessions = await this.prisma.callSession.findMany({
      where: {
        organizationId,
        callerNumber,
        status: 'COMPLETED',
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 3,
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 10,
        },
      },
    });

    if (recentSessions.length === 0) {
      return '';
    }

    // Compile message excerpts into a string summary
    const summaryLines = recentSessions.map((session, index) => {
      const messagesText = session.messages
        .map(m => `${m.role}: ${m.content.slice(0, 100)}`)
        .join(' | ');
      return `Call ${index + 1} (${session.createdAt.toDateString()}): ${messagesText || 'No transcripts available'}`;
    });

    return summaryLines.join('\n');
  }

  /**
   * Generates and stores a conversational summary of a completed call session
   */
  async generateAndSaveSessionSummary(callSessionId: string): Promise<void> {
    this.logger.log(`Compiling conversation summary for session ${callSessionId}`);

    const messages = await this.prisma.conversationMessage.findMany({
      where: { callSessionId },
      orderBy: { createdAt: 'asc' },
    });

    if (messages.length === 0) return;

    // Simple textual summary construction (in production, triggers an LLM summary completion)
    const summaryText = `Call ended. Total turns: ${messages.length}. Messages: ${messages
      .slice(-3)
      .map(m => `${m.role}: ${m.content}`)
      .join(' -> ')}`;

    this.logger.log(`Summary generated: ${summaryText}`);

    // Update the CallSession table with S3 / context reference or custom detail logs
    await this.prisma.auditLog.create({
      data: {
        action: 'CALL_SUMMARY_GENERATED',
        resource: 'CallSession',
        details: `Call Session: ${callSessionId}. Summary: ${summaryText}`,
      },
    });
  }
}

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventBusService, DomainEventType } from '../../common/event-bus/event-bus.service';
import { ObservabilityService } from '../../common/observability/observability.service';
import { AiOrchestratorService } from '../ai-orchestrator/ai-orchestrator.service';
import { MemoryService } from '../memory/memory.service';
import { AiProvider } from '../ai-orchestrator/interfaces/ai-provider.interface';
import { StructuredLogger } from '../../common/logger/logger.service';
import { ToolEngineService } from '../tool-engine/tool-engine.service';

interface ActiveVoiceSession {
  callSessionId: string;
  organizationId: string;
  assistantId: string;
  aiProvider: AiProvider;
  onAudioOut: (chunk: Buffer) => void;
  transcriptBuffer: string[];
}

@Injectable()
export class ConversationEngineService {
  private readonly activeSessions = new Map<string, ActiveVoiceSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly observability: ObservabilityService,
    @Inject(forwardRef(() => AiOrchestratorService))
    private readonly aiOrchestrator: AiOrchestratorService,
    @Inject(forwardRef(() => MemoryService))
    private readonly memoryService: MemoryService,
    private readonly toolEngineService: ToolEngineService,
    private readonly logger: StructuredLogger
  ) {
    this.logger.setContext('ConversationEngine');
  }

  async initializeSession(
    callSessionId: string,
    onAudioOut: (chunk: Buffer) => void,
    onTextOut?: (text: string) => void
  ): Promise<void> {
    this.logger.log(`Initializing conversation engine state for call: ${callSessionId}`);

    // 1. Fetch Call Session & Assistant configurations
    const callSession = await this.prisma.callSession.findUnique({
      where: { id: callSessionId },
      include: {
        assistant: {
          include: {
            aiProviderConfig: true,
          },
        },
      },
    });

    if (!callSession) {
      throw new Error(`Call session ${callSessionId} not found in database.`);
    }

    const { organizationId, assistantId, assistant } = callSession;

    // 2. Fetch conversational context memory (Retrieve previous call summaries if any)
    const longTermContext = await this.memoryService.retrieveLongTermContext(organizationId, callSession.callerNumber);

    // 3. Prompt Construction
    const basePrompt = assistant.systemInstruction;
    const finalSystemPrompt = `
${basePrompt}
---
[HISTORICAL SUMMARY OF CALLER]:
${longTermContext || 'First time caller. No historical records.'}
---
Ensure replies are extremely concise and natural for real-time voice conversations. Keep sentences short.
`;

    // 4. Resolve AI Provider from the AI Orchestrator
    const aiProvider = this.aiOrchestrator.resolveProvider(assistant.aiProviderConfig.providerName);

    const activeSession: ActiveVoiceSession = {
      callSessionId,
      organizationId,
      assistantId,
      aiProvider,
      onAudioOut,
      transcriptBuffer: [],
    };

    // Fetch registered tools
    const tools = this.toolEngineService.getRegisteredTools();

    // 5. Connect and attach event callbacks
    await aiProvider.connect(
      {
        systemInstruction: finalSystemPrompt,
        voiceId: assistant.voiceId,
        model: assistant.model,
        language: assistant.language,
        tools,
      },
      {
        onAudioChunk: (chunk: Buffer) => {
          // Playback synthesized audio
          onAudioOut(chunk);
        },
        onTextDelta: (delta: string) => {
          activeSession.transcriptBuffer.push(delta);
          if (onTextOut) {
            onTextOut(delta);
          }
        },
        onSpeechStarted: () => {
          // INTERRUPTION / BARGE-IN: User started speaking while AI was playing audio. Clear buffers!
          this.logger.log(`Interruption detected in session ${callSessionId}. Stopping response.`);
          aiProvider.cancelResponse();
          this.eventBus.publish({
            type: DomainEventType.SpeechStarted,
            organizationId,
            callSessionId,
            payload: {},
          });
        },
        onSpeechStopped: () => {
          this.eventBus.publish({
            type: DomainEventType.SpeechEnded,
            organizationId,
            callSessionId,
            payload: {},
          });
        },
        onResponseStarted: () => {
          this.eventBus.publish({
            type: DomainEventType.ResponseStarted,
            organizationId,
            callSessionId,
            payload: {},
          });
        },
        onResponseCompleted: async (transcript: string, promptTokens: number, completionTokens: number) => {
          this.logger.log(`AI response completed: "${transcript}"`);
          
          // Save turn data into database
          await this.prisma.conversationMessage.create({
            data: {
              callSessionId,
              role: 'ASSISTANT',
              content: transcript,
              tokenCount: promptTokens + completionTokens,
            },
          });

          // Track usage & Observability
          this.observability.recordTokenUsage(promptTokens, completionTokens, organizationId, assistant.model);

          this.eventBus.publish({
            type: DomainEventType.ResponseCompleted,
            organizationId,
            callSessionId,
            payload: { transcript, promptTokens, completionTokens },
          });
        },
        onToolCall: async (name: string, args: Record<string, any>, callId: string) => {
          this.logger.log(`Executing tool callback inside conversation engine: ${name} (callId: ${callId})`);
          const result = await this.toolEngineService.executeTool(name, args, organizationId);
          return JSON.stringify(result);
        },
        onError: (error: Error) => {
          this.logger.error(`AI Provider error on call ${callSessionId}`, error.stack);
        },
      }
    );

    this.activeSessions.set(callSessionId, activeSession);

    this.eventBus.publish({
      type: DomainEventType.CallAnswered,
      organizationId,
      callSessionId,
      payload: {},
    });
  }

  streamAudio(callSessionId: string, chunk: Buffer) {
    const session = this.activeSessions.get(callSessionId);
    if (!session) return;

    // Direct buffer piping
    session.aiProvider.sendAudioChunk(chunk);
  }

  async terminateSession(callSessionId: string): Promise<void> {
    this.logger.log(`Terminating conversation engine session: ${callSessionId}`);
    const session = this.activeSessions.get(callSessionId);
    if (!session) return;

    // Disconnect AI socket
    await session.aiProvider.disconnect();
    this.activeSessions.delete(callSessionId);

    // Dispatch Call ended events to process analytics & post-call tasks async
    this.eventBus.publish({
      type: DomainEventType.CallEnded,
      organizationId: session.organizationId,
      callSessionId,
      payload: {},
    });
  }
}

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventBusService, DomainEventType } from '../../common/event-bus/event-bus.service';
import { ObservabilityService } from '../../common/observability/observability.service';
import { AiOrchestratorService } from '../ai-orchestrator/ai-orchestrator.service';
import { MemoryService } from '../memory/memory.service';
import { AiProvider } from '../ai-orchestrator/interfaces/ai-provider.interface';
import { StructuredLogger } from '../../common/logger/logger.service';
import { ToolEngineService } from '../tool-engine/tool-engine.service';
import { LatencyService } from '../latency/latency.service';
import { DecisionEngineService } from '../latency/decision-engine.service';

interface ActiveVoiceSession {
  callSessionId: string;
  organizationId: string;
  assistantId: string;
  aiProvider: AiProvider;
  onAudioOut: (chunk: Buffer) => void;
  transcriptBuffer: string[];
  /** Cached at session init — avoids per-turn env reads */
  latencyEnabled: boolean;
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
    private readonly logger: StructuredLogger,
    private readonly latencyService: LatencyService,
    private readonly decisionEngine: DecisionEngineService,
    private readonly configService: ConfigService,
  ) {
    this.logger.setContext('ConversationEngine');
  }

  async initializeSession(
    callSessionId: string,
    onAudioOut: (chunk: Buffer) => void,
    onTextOut?: (text: string) => void,
  ): Promise<void> {
    this.logger.log(`Initializing conversation engine state for call: ${callSessionId}`);

    // ── Feature flag: resolved once per session from env (sync, ~0μs) ──────
    // Using process.env directly (not FeatureFlagService) to avoid DB I/O
    // in the real-time session init path.
    const latencyEnabled =
      String(this.configService.get('ENABLE_LATENCY_LAYER', false)) === 'true';

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

    // 2. Fetch conversational context memory (Retrieve caller profile and facts)
    const callerContext = await this.memoryService.loadUserContext(callSession.callerNumber);
    
    // Observability: record memory injection size
    this.observability.recordMemoriesInjected(callerContext.memories.length);

    const memoryLines = callerContext.memories
      .map(m => `- ${m.key}: ${m.value}`)
      .join('\n');

    const callerInfoBlock = `
[CALLER PROFILE & MEMORY]:
- Name: ${callerContext.name ?? 'Unknown'}
- Phone Number: ${callerContext.phoneNumber}
${memoryLines ? `\n[KNOWN PREFERENCES]:\n${memoryLines}` : '- No prior preferences stored.'}
---
Instructions:
- Use memory naturally in conversation when relevant.
- Do NOT explicitly say "I remember" or "based on your settings".
- Keep responses conversational.
`;

    // 3. Start latency tracking (non-blocking — allocates in-memory entry + TTL handle)
    if (latencyEnabled) {
      await this.latencyService.startTracking(callSessionId);
    }

    // 4. Resolve strategy BEFORE building prompt (sync, O(1))
    //    On the first turn there is no history yet — getStrategy returns 'FULL'.
    const strategy = latencyEnabled
      ? await this.decisionEngine.getStrategy(callSessionId)
      : 'FULL';

    // 5. Prompt Construction — strategy may append a constraint
    const basePrompt = assistant.systemInstruction;

    const strategyInstruction =
      latencyEnabled && strategy === 'SHORT'
        ? '\nIMPORTANT: The network is experiencing high latency. Respond in ONE short sentence only.'
        : '';

    const finalSystemPrompt = `
${basePrompt}
---
${callerInfoBlock}
---
Ensure replies are extremely concise and natural for real-time voice conversations. Keep sentences short.${strategyInstruction}
`;

    // 6. Resolve AI Provider from the AI Orchestrator
    const aiProvider = this.aiOrchestrator.resolveProvider(assistant.aiProviderConfig.providerName);

    const activeSession: ActiveVoiceSession = {
      callSessionId,
      organizationId,
      assistantId,
      aiProvider,
      onAudioOut,
      transcriptBuffer: [],
      latencyEnabled,
    };

    // Fetch registered tools
    const tools = this.toolEngineService.getRegisteredTools();

    // 7. Connect and attach event callbacks
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
          // ── Latency: mark request start (sync, ~1μs — no await) ──────────
          if (latencyEnabled) {
            this.latencyService.markAIRequestStart(callSessionId);
          }

          this.eventBus.publish({
            type: DomainEventType.ResponseStarted,
            organizationId,
            callSessionId,
            payload: {},
          });
        },
        onResponseCompleted: async (
          transcript: string,
          promptTokens: number,
          completionTokens: number,
        ) => {
          this.logger.log(`AI response completed: "${transcript}"`);

          // ── Latency: mark response end (async) ───────────────────────────
          if (latencyEnabled) {
            await this.latencyService.markAIResponseEnd(callSessionId);
          }

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
          this.observability.recordTokenUsage(
            promptTokens,
            completionTokens,
            organizationId,
            assistant.model,
          );

          this.eventBus.publish({
            type: DomainEventType.ResponseCompleted,
            organizationId,
            callSessionId,
            payload: { transcript, promptTokens, completionTokens },
          });
        },
        onToolCall: async (name: string, args: Record<string, any>, callId: string) => {
          this.logger.log(
            `Executing tool callback inside conversation engine: ${name} (callId: ${callId})`,
          );
          const toolStart = Date.now();
          const result = await this.toolEngineService.executeTool(name, args, organizationId);

          // ── Latency: accumulate tool execution time (async) ──────────────
          if (latencyEnabled) {
            await this.latencyService.markToolExecution(callSessionId, Date.now() - toolStart);
          }

          return JSON.stringify(result);
        },
        onError: (error: Error) => {
          this.logger.error(`AI Provider error on call ${callSessionId}`, error.stack);
        },
      },
    );

    this.activeSessions.set(callSessionId, activeSession);

    // 8. FILLER: fire-and-forget bridging phrase when latency is critical.
    //    Gated by rate limiter — at most once per fillerCooldownMs interval.
    //    The AI call has already been dispatched above; this is purely additive.
    if (latencyEnabled && strategy === 'FILLER') {
      const cooldownMs = this.decisionEngine.getFillerCooldownMs();
      if (await this.latencyService.shouldSendFiller(callSessionId, cooldownMs)) {
        await this.latencyService.recordFillerSent(callSessionId);
        // Fire-and-forget: no await — does not delay execution
        void aiProvider
          .sendTextMessage('Let me check that for you...')
          .catch((err: Error) =>
            this.logger.error(`Failed to send filler for session ${callSessionId}`, err.stack),
          );
        this.logger.debug(`FILLER response triggered for session ${callSessionId}`);
      }
    }

    // 9. Prompt initial greeting from the AI assistant (fire-and-forget)
    void aiProvider
      .sendTextMessage('Greet the user.')
      .catch((err: Error) =>
        this.logger.error(`Failed to trigger initial greeting response for session ${callSessionId}: ${err.message}`, err.stack),
      );

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

    // Latency cleanup — cancels TTL, removes store entry
    if (session.latencyEnabled) {
      await this.latencyService.stopTracking(callSessionId);
      this.decisionEngine.clearSession(callSessionId);
    }

    // Dispatch Call ended events to process analytics & post-call tasks async
    this.eventBus.publish({
      type: DomainEventType.CallEnded,
      organizationId: session.organizationId,
      callSessionId,
      payload: {},
    });
  }
}

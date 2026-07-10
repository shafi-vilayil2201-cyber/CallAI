import { Test, TestingModule } from '@nestjs/testing';
import { ConversationEngineService } from './conversation-engine.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventBusService } from '../../common/event-bus/event-bus.service';
import { ObservabilityService } from '../../common/observability/observability.service';
import { AiOrchestratorService } from '../ai-orchestrator/ai-orchestrator.service';
import { MemoryService } from '../memory/memory.service';
import { ToolEngineService } from '../tool-engine/tool-engine.service';
import { StructuredLogger } from '../../common/logger/logger.service';
import { AiProvider } from '../ai-orchestrator/interfaces/ai-provider.interface';

describe('ConversationEngineService', () => {
  let service: ConversationEngineService;
  let prisma: PrismaService;
  let memoryService: MemoryService;
  let toolEngineService: ToolEngineService;
  let aiOrchestrator: AiOrchestratorService;

  const mockAiProvider: jest.Mocked<AiProvider> = {
    connect: jest.fn().mockResolvedValue(undefined),
    sendAudioChunk: jest.fn().mockResolvedValue(undefined),
    sendTextMessage: jest.fn().mockResolvedValue(undefined),
    cancelResponse: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
  };

  const mockPrisma = {
    callSession: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'session_123',
        organizationId: 'org_123',
        assistantId: 'asst_123',
        callerNumber: '+919999999999',
        assistant: {
          systemInstruction: 'You are a helpful helper.',
          voiceId: 'alloy',
          model: 'gpt-4o-realtime',
          language: 'en-US',
          aiProviderConfig: {
            providerName: 'openai',
          },
        },
      }),
    },
  };

  const mockEventBus = {
    publish: jest.fn(),
  };

  const mockObservability = {
    recordAudioChunk: jest.fn(),
    recordTokenUsage: jest.fn(),
  };

  const mockAiOrchestrator = {
    resolveProvider: jest.fn().mockReturnValue(mockAiProvider),
  };

  const mockMemoryService = {
    retrieveLongTermContext: jest.fn().mockResolvedValue('Spoke to customer yesterday.'),
  };

  const mockToolEngineService = {
    getRegisteredTools: jest.fn().mockReturnValue([
      {
        name: 'testTool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
      },
    ]),
    executeTool: jest.fn().mockResolvedValue({ success: true, data: { value: 'ok' } }),
  };

  const mockLogger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationEngineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventBusService, useValue: mockEventBus },
        { provide: ObservabilityService, useValue: mockObservability },
        { provide: AiOrchestratorService, useValue: mockAiOrchestrator },
        { provide: MemoryService, useValue: mockMemoryService },
        { provide: ToolEngineService, useValue: mockToolEngineService },
        { provide: StructuredLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<ConversationEngineService>(ConversationEngineService);
    prisma = module.get<PrismaService>(PrismaService);
    memoryService = module.get<MemoryService>(MemoryService);
    toolEngineService = module.get<ToolEngineService>(ToolEngineService);
    aiOrchestrator = module.get<AiOrchestratorService>(AiOrchestratorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should resolve context, tools, and call provider connect', async () => {
    const onAudioOut = jest.fn();
    await service.initializeSession('session_123', onAudioOut);

    expect(prisma.callSession.findUnique).toHaveBeenCalledWith({
      where: { id: 'session_123' },
      include: {
        assistant: {
          include: {
            aiProviderConfig: true,
          },
        },
      },
    });

    expect(memoryService.retrieveLongTermContext).toHaveBeenCalledWith('org_123', '+919999999999');
    expect(toolEngineService.getRegisteredTools).toHaveBeenCalled();
    expect(aiOrchestrator.resolveProvider).toHaveBeenCalledWith('openai');

    expect(mockAiProvider.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        systemInstruction: expect.stringContaining('Spoke to customer yesterday.'),
        voiceId: 'alloy',
        model: 'gpt-4o-realtime',
        language: 'en-US',
        tools: [
          {
            name: 'testTool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      }),
      expect.any(Object)
    );
  });

  it('should forward onToolCall execution through the ToolEngineService', async () => {
    const onAudioOut = jest.fn();
    await service.initializeSession('session_123', onAudioOut);

    // Retrieve callback argument passed to connect()
    const callbacks = mockAiProvider.connect.mock.calls[0][1];
    expect(callbacks.onToolCall).toBeDefined();

    const args = { arg: 1 };
    const result = await callbacks.onToolCall!('testTool', args, 'call_abc');

    expect(toolEngineService.executeTool).toHaveBeenCalledWith('testTool', args, 'org_123');
    expect(result).toBe(JSON.stringify({ success: true, data: { value: 'ok' } }));
  });
});

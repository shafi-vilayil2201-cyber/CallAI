import { Test, TestingModule } from '@nestjs/testing';
import { QueueEventSubscriber } from './queue-event-subscriber.service';
import { EventBusService, DomainEventType } from '../../common/event-bus/event-bus.service';
import { StructuredLogger } from '../../common/logger/logger.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getQueueToken } from '@nestjs/bullmq';
import { Subject } from 'rxjs';

describe('QueueEventSubscriber', () => {
  let subscriber: QueueEventSubscriber;
  let eventBus: EventBusService;
  let prisma: PrismaService;
  let analyticsQueue: any;
  let recordingQueue: any;
  let webhookQueue: any;
  let callEndedSubject: Subject<any>;
  let allEventsSubject: Subject<any>;

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job_123' }),
  };

  const mockLogger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const mockPrisma = {
    webhook: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    callEndedSubject = new Subject<any>();
    allEventsSubject = new Subject<any>();
    const mockEventBus = {
      ofEvent: jest.fn().mockReturnValue(callEndedSubject.asObservable()),
      getEvents$: jest.fn().mockReturnValue(allEventsSubject.asObservable()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueEventSubscriber,
        { provide: EventBusService, useValue: mockEventBus },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken('call-analytics'), useValue: { ...mockQueue, add: jest.fn().mockResolvedValue({ id: 'analytics_job' }) } },
        { provide: getQueueToken('recording-upload'), useValue: { ...mockQueue, add: jest.fn().mockResolvedValue({ id: 'recording_job' }) } },
        { provide: getQueueToken('webhook-dispatch'), useValue: { ...mockQueue, add: jest.fn().mockResolvedValue({ id: 'webhook_job' }) } },
        { provide: StructuredLogger, useValue: mockLogger },
      ],
    }).compile();

    subscriber = module.get<QueueEventSubscriber>(QueueEventSubscriber);
    eventBus = module.get<EventBusService>(EventBusService);
    prisma = module.get<PrismaService>(PrismaService);
    analyticsQueue = module.get(getQueueToken('call-analytics'));
    recordingQueue = module.get(getQueueToken('recording-upload'));
    webhookQueue = module.get(getQueueToken('webhook-dispatch'));

    // Trigger onModuleInit to subscribe to events
    subscriber.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(subscriber).toBeDefined();
  });

  it('should subscribe to CallEnded events and enqueue background tasks', async () => {
    const mockEvent = {
      type: DomainEventType.CallEnded,
      callSessionId: 'session_123',
      organizationId: 'org_123',
      timestamp: new Date(),
      payload: {},
    };

    // Mock webhook query returning empty array for this specific check
    mockPrisma.webhook.findMany.mockResolvedValue([]);

    // Emit event to both streams
    callEndedSubject.next(mockEvent);
    allEventsSubject.next(mockEvent);

    // Wait for async handler microtasks
    await new Promise(resolve => setImmediate(resolve));

    expect(eventBus.ofEvent).toHaveBeenCalledWith(DomainEventType.CallEnded);
    
    // Assert analytics queue was called
    expect(analyticsQueue.add).toHaveBeenCalledWith('process-analytics', {
      callSessionId: 'session_123',
    });

    // Assert recording queue was called
    expect(recordingQueue.add).toHaveBeenCalledWith('upload-recording', {
      callSessionId: 'session_123',
      rawAudioBase64: expect.any(String),
    });
  });

  it('should query active tenant webhooks and enqueue webhook-dispatch tasks if matching rules exist', async () => {
    const mockEvent = {
      type: DomainEventType.CallStarted,
      callSessionId: 'session_123',
      organizationId: 'org_123',
      timestamp: new Date(),
      payload: { callerNumber: '+919999999999' },
    };

    const mockWebhooks = [
      {
        id: 'webhook_abc',
        name: 'Client API Endpoint',
        url: 'https://client.example.com/callback',
        secret: 'webhook_secret_key',
        eventTypes: ['CallStarted'],
        isActive: true,
      },
    ];

    // Mock Prisma query to return the webhook configuration
    mockPrisma.webhook.findMany.mockResolvedValue(mockWebhooks);

    // Emit general event
    allEventsSubject.next(mockEvent);

    // Wait for microtasks
    await new Promise(resolve => setImmediate(resolve));

    expect(prisma.webhook.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: mockEvent.organizationId,
        isActive: true,
        eventTypes: {
          has: mockEvent.type,
        },
      },
    });

    expect(webhookQueue.add).toHaveBeenCalledWith('dispatch-webhook', {
      webhookId: 'webhook_abc',
      url: 'https://client.example.com/callback',
      secret: 'webhook_secret_key',
      event: mockEvent,
    });
  });
});

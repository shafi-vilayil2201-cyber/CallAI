import { Test, TestingModule } from '@nestjs/testing';
import { TelephonyController } from './telephony.controller';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventBusService } from '../../common/event-bus/event-bus.service';
import { StructuredLogger } from '../../common/logger/logger.service';

describe('TelephonyController', () => {
  let controller: TelephonyController;
  let prisma: PrismaService;

  const mockPrisma = {
    assistant: {
      findFirst: jest.fn().mockResolvedValue({ id: 'asst_123' }),
    },
    organization: {
      findFirst: jest.fn().mockResolvedValue({ id: 'org_123' }),
    },
    callSession: {
      create: jest.fn().mockResolvedValue({
        id: 'session_123',
        status: 'INITIATED',
        callerNumber: '+919999999999',
        receiverNumber: '+918888888888',
        providerCallId: 'sid_123',
        organizationId: 'org_123',
      }),
    },
  };

  const mockEventBus = {
    publish: jest.fn(),
  };

  const mockLogger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelephonyController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventBusService, useValue: mockEventBus },
        { provide: StructuredLogger, useValue: mockLogger },
      ],
    }).compile();

    controller = module.get<TelephonyController>(TelephonyController);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create a call session and return WS instruction on inbound calls', async () => {
    const payload = {
      CallSid: 'sid_123',
      From: '+919999999999',
      To: '+918888888888',
    };

    const result = await controller.handleExotelInboundCall(payload);

    expect(prisma.assistant.findFirst).toHaveBeenCalled();
    expect(prisma.organization.findFirst).toHaveBeenCalled();
    expect(prisma.callSession.create).toHaveBeenCalledWith({
      data: {
        status: 'INITIATED',
        callerNumber: payload.From,
        receiverNumber: payload.To,
        providerCallId: payload.CallSid,
        providerName: 'exotel',
        assistantId: 'asst_123',
        organizationId: 'org_123',
      },
    });

    expect(mockEventBus.publish).toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect((result as any).instruction.action).toBe('stream');
  });

  it('should support twilio inbound calls returning XML TwiML response', async () => {
    const payload = {
      CallSid: 'sid_twilio_123',
      From: '+1234567890',
      To: '+1098765432',
    };

    // Update mock session create return value
    mockPrisma.callSession.create.mockResolvedValueOnce({
      id: 'session_twilio_123',
      status: 'INITIATED',
      callerNumber: payload.From,
      receiverNumber: payload.To,
      providerCallId: payload.CallSid,
      organizationId: 'org_123',
    });

    const result = await controller.handleTwilioInboundCall(payload);

    expect(result).toContain('<Response>');
    expect(result).toContain('<Connect>');
    expect(result).toContain('<Stream');
  });
});

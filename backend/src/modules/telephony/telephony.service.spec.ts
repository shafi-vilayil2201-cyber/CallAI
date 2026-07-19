import { Test, TestingModule } from '@nestjs/testing';
import { TelephonyService } from './telephony.service';
import { ExotelProvider } from './providers/exotel.provider';
import { TwilioProvider } from './providers/twilio.provider';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StructuredLogger } from '../../common/logger/logger.service';

describe('TelephonyService', () => {
  let service: TelephonyService;
  let exotelProvider: ExotelProvider;
  let twilioProvider: TwilioProvider;
  let prisma: PrismaService;

  const mockExotelProvider = {
    initiateCall: jest.fn().mockResolvedValue({ providerCallId: 'exotel_sid', status: 'initiated' }),
    hangupCall: jest.fn().mockResolvedValue(undefined),
    transferCall: jest.fn().mockResolvedValue(undefined),
    playAudio: jest.fn().mockResolvedValue(undefined),
  };

  const mockTwilioProvider = {
    initiateCall: jest.fn().mockResolvedValue({ providerCallId: 'twilio_sid', status: 'queued' }),
    hangupCall: jest.fn().mockResolvedValue(undefined),
    transferCall: jest.fn().mockResolvedValue(undefined),
    playAudio: jest.fn().mockResolvedValue(undefined),
  };

  const mockPrisma = {
    callSession: {
      findUnique: jest.fn(),
    },
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
        TelephonyService,
        { provide: ExotelProvider, useValue: mockExotelProvider },
        { provide: TwilioProvider, useValue: mockTwilioProvider },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StructuredLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<TelephonyService>(TelephonyService);
    exotelProvider = module.get<ExotelProvider>(ExotelProvider);
    twilioProvider = module.get<TwilioProvider>(TwilioProvider);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should route +91 receiver numbers to ExotelProvider', async () => {
    const dto = {
      callerNumber: '+918888888888',
      receiverNumber: '+919999999999',
      assistantId: 'asst_123',
      organizationId: 'org_123',
    };

    const result = await service.initiateCall(dto);

    expect(exotelProvider.initiateCall).toHaveBeenCalledWith(dto);
    expect(twilioProvider.initiateCall).not.toHaveBeenCalled();
    expect(result.providerCallId).toBe('exotel_sid');
  });

  it('should route international receiver numbers to TwilioProvider', async () => {
    const dto = {
      callerNumber: '+1234567890',
      receiverNumber: '+1987654321', // US number
      assistantId: 'asst_123',
      organizationId: 'org_123',
    };

    const result = await service.initiateCall(dto);

    expect(twilioProvider.initiateCall).toHaveBeenCalledWith(dto);
    expect(exotelProvider.initiateCall).not.toHaveBeenCalled();
    expect(result.providerCallId).toBe('twilio_sid');
  });

  it('should check db providerName and route hangup to Exotel', async () => {
    mockPrisma.callSession.findUnique.mockResolvedValue({
      providerName: 'exotel',
    });

    await service.hangupCall('call_sid_123');

    expect(prisma.callSession.findUnique).toHaveBeenCalledWith({
      where: { providerCallId: 'call_sid_123' },
    });
    expect(exotelProvider.hangupCall).toHaveBeenCalledWith('call_sid_123');
    expect(twilioProvider.hangupCall).not.toHaveBeenCalled();
  });

  it('should check db providerName and route hangup to Twilio', async () => {
    mockPrisma.callSession.findUnique.mockResolvedValue({
      providerName: 'twilio',
    });

    await service.hangupCall('call_sid_456');

    expect(prisma.callSession.findUnique).toHaveBeenCalledWith({
      where: { providerCallId: 'call_sid_456' },
    });
    expect(twilioProvider.hangupCall).toHaveBeenCalledWith('call_sid_456');
    expect(exotelProvider.hangupCall).not.toHaveBeenCalled();
  });
});

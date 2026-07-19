import { Test, TestingModule } from '@nestjs/testing';
import { MemoryService } from './memory.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ObservabilityService } from '../../common/observability/observability.service';
import { StructuredLogger } from '../../common/logger/logger.service';

// Mock Redis
const mockStoreMap = new Map<string, string>();
jest.mock('ioredis', () => {
  return {
    default: jest.fn().mockImplementation(() => {
      return {
        get: jest.fn().mockImplementation(async (key: string) => mockStoreMap.get(key) || null),
        set: jest.fn().mockImplementation(async (key: string, val: string) => {
          mockStoreMap.set(key, val);
          return 'OK';
        }),
        del: jest.fn().mockImplementation(async (key: string) => {
          mockStoreMap.delete(key);
          return 1;
        }),
        quit: jest.fn().mockResolvedValue('OK'),
        on: jest.fn(),
      };
    }),
  };
});

describe('MemoryService', () => {
  let service: MemoryService;
  let prisma: PrismaService;

  const mockPrisma: any = {
    caller: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    callerMemory: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    callerCallLog: {
      create: jest.fn(),
    },
    callSession: {
      findUnique: jest.fn(),
    },
    conversationMessage: {
      findMany: jest.fn(),
    },
  };
  mockPrisma.$transaction = jest.fn((cb) => cb(mockPrisma));

  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === 'GEMINI_API_KEY') return 'test-gemini-key';
      return null;
    }),
  };

  const mockObservability = {
    recordMemoryHit: jest.fn(),
    recordMemoryMiss: jest.fn(),
    recordMemoriesExtracted: jest.fn(),
    recordMemoriesInjected: jest.fn(),
  };

  const mockLogger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: ObservabilityService, useValue: mockObservability },
        { provide: StructuredLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
    prisma = module.get<PrismaService>(PrismaService);
    service.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('normalizePhoneNumber', () => {
    it('should strip non-digits and normalize E.164 formats', () => {
      expect(service.normalizePhoneNumber('099999 88888')).toBe('+919999988888');
      expect(service.normalizePhoneNumber('+1 (669) 337-7756')).toBe('+16693377756');
    });
  });

  describe('shouldStoreMemory', () => {
    it('should block OTP, password, card and ssn keys', () => {
      expect(service.shouldStoreMemory('user_otp', '123456')).toBe(false);
      expect(service.shouldStoreMemory('ssn_number', '123-456')).toBe(false);
      expect(service.shouldStoreMemory('favorite_food', 'Paneer Tikka')).toBe(true);
    });

    it('should block short values', () => {
      expect(service.shouldStoreMemory('food', 'ab')).toBe(false);
    });
  });

  describe('loadUserContext', () => {
    it('should load caller context from DB on cache miss and write to cache', async () => {
      const mockCaller = { id: 'c123', phoneNumber: '+16693377756', name: 'Shafi', preferences: {} };
      mockPrisma.caller.upsert.mockResolvedValue(mockCaller);
      mockPrisma.callerMemory.findMany.mockResolvedValue([
        { key: 'hobby', value: 'coding', weight: 1.0, lastUsed: new Date() },
      ]);

      const context = await service.loadUserContext('+16693377756');
      expect(context.name).toBe('Shafi');
      expect(context.memories).toEqual([{ key: 'hobby', value: 'coding' }]);
      expect(mockObservability.recordMemoryMiss).toHaveBeenCalled();

      // Second load should trigger cache hit
      const contextCached = await service.loadUserContext('+16693377756');
      expect(contextCached.name).toBe('Shafi');
      expect(mockObservability.recordMemoryHit).toHaveBeenCalled();
    });
  });

  describe('storeMemory', () => {
    it('should persist new memories and update weights for existing ones', async () => {
      const callerId = 'c123';
      const memories = [
        { key: 'hobby', value: 'cooking' },
        { key: 'name', value: 'Shafi' },
      ];

      // Hobby doesn't exist yet, Name exists
      mockPrisma.callerMemory.findUnique
        .mockResolvedValueOnce(null) // hobby check
        .mockResolvedValueOnce({ id: 'm456', key: 'name', value: 'Shafi', weight: 1.0 }); // name check

      await service.storeMemory(callerId, memories);

      expect(mockPrisma.callerMemory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { callerId, key: 'hobby', value: 'cooking', weight: 1.0 },
        })
      );
      expect(mockPrisma.callerMemory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm456' },
          data: expect.objectContaining({ value: 'Shafi', weight: 1.2 }),
        })
      );
    });
  });
});

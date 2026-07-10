import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagService } from './feature-flag.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StructuredLogger } from '../../common/logger/logger.service';

describe('FeatureFlagService', () => {
  let service: FeatureFlagService;
  let prisma: PrismaService;

  const mockPrisma = {
    featureFlag: {
      findUnique: jest.fn(),
    },
    organizationSettings: {
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
        FeatureFlagService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StructuredLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<FeatureFlagService>(FeatureFlagService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isEnabled', () => {
    it('should return false if feature flag is not registered in system', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValueOnce(null);

      const result = await service.isEnabled('UNKNOWN_FLAG');

      expect(result).toBe(false);
      expect(prisma.featureFlag.findUnique).toHaveBeenCalledWith({ where: { name: 'UNKNOWN_FLAG' } });
    });

    it('should return true if flag is enabled globally', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValueOnce({
        name: 'GLOBAL_FLAG',
        isEnabledGlobally: true,
      });

      const result = await service.isEnabled('GLOBAL_FLAG');

      expect(result).toBe(true);
    });

    it('should fall back to organization settings if not enabled globally but orgId provided', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValueOnce({
        name: 'ENABLE_RECORDING',
        isEnabledGlobally: false,
      });
      mockPrisma.organizationSettings.findUnique.mockResolvedValueOnce({
        recordingEnabled: true,
      });

      const result = await service.isEnabled('ENABLE_RECORDING', 'org-id');

      expect(result).toBe(true);
      expect(prisma.organizationSettings.findUnique).toHaveBeenCalledWith({ where: { organizationId: 'org-id' } });
    });

    it('should return false if org settings disable the requested flag override', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValueOnce({
        name: 'ENABLE_RECORDING',
        isEnabledGlobally: false,
      });
      mockPrisma.organizationSettings.findUnique.mockResolvedValueOnce({
        recordingEnabled: false,
      });

      const result = await service.isEnabled('ENABLE_RECORDING', 'org-id');

      expect(result).toBe(false);
    });
  });
});

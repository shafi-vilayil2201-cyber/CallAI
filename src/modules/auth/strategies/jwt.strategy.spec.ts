import { Test, TestingModule } from '@nestjs/testing';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: PrismaService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string, defaultValue?: string) => {
      if (key === 'JWT_SECRET') return 'test-jwt-secret-min-16-chars';
      return defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    const payload = {
      sub: 'user-id',
      email: 'test@example.com',
      organizationId: 'org-id',
      role: 'ADMIN',
    };

    it('should throw UnauthorizedException if user does not exist in DB', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-id' } });
    });

    it('should return token payload details if user exists in DB', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-id', email: 'test@example.com' });

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        userId: 'user-id',
        email: 'test@example.com',
        organizationId: 'org-id',
        role: 'ADMIN',
      });
    });
  });
});

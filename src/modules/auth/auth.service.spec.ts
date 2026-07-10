import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { StructuredLogger } from '../../common/logger/logger.service';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const mockPrisma: any = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    organization: {
      create: jest.fn(),
    },
    organizationSettings: {
      create: jest.fn(),
    },
    billing: {
      create: jest.fn(),
    },
    apiKey: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrisma)),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
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
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: StructuredLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const registerDto = {
      email: 'test@example.com',
      password: 'password123',
      organizationName: 'Test Org',
    };

    it('should throw ConflictException if user email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'existing-id' });

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('should hash password and create organization + settings + billing + user transactionally', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.organization.create.mockResolvedValueOnce({ id: 'org-id', name: 'Test Org' });
      mockPrisma.user.create.mockResolvedValueOnce({
        id: 'user-id',
        email: 'test@example.com',
        role: 'ADMIN',
        organizationId: 'org-id',
      });

      const result = await service.register(registerDto);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.organization.create).toHaveBeenCalledWith({
        data: { name: 'Test Org' },
      });
      expect(mockPrisma.user.create).toHaveBeenCalled();
      expect(jwtService.sign).toHaveBeenCalled();
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.user.email).toBe('test@example.com');
    });
  });

  describe('login', () => {
    const loginDto = {
      email: 'test@example.com',
      password: 'password123',
    };

    it('should throw UnauthorizedException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password compare fails', async () => {
      const mockHash = await bcrypt.hash('different-password', 4);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-id',
        email: 'test@example.com',
        passwordHash: mockHash,
        organization: { name: 'Test Org' },
      });

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should return token and user context on successful password check', async () => {
      const mockHash = await bcrypt.hash('password123', 4);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-id',
        email: 'test@example.com',
        passwordHash: mockHash,
        organization: { name: 'Test Org' },
        organizationId: 'org-id',
        role: 'ADMIN',
      });

      const result = await service.login(loginDto);

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-id',
        email: 'test@example.com',
        organizationId: 'org-id',
        role: 'ADMIN',
      });
      expect(result.accessToken).toBe('mock-jwt-token');
    });
  });

  describe('validateApiKey', () => {
    it('should return null if API key is not found', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValueOnce(null);

      const result = await service.validateApiKey('cai_live_invalid');
      expect(result).toBeNull();
    });

    it('should return null if API key is inactive', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValueOnce({
        id: 'key-id',
        isActive: false,
      });

      const result = await service.validateApiKey('cai_live_inactive');
      expect(result).toBeNull();
    });

    it('should return developer context if API key is valid and active', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValueOnce({
        id: 'key-id',
        isActive: true,
        organizationId: 'org-id',
        organization: {
          users: [{ id: 'admin-id', email: 'admin@org.com', role: 'ADMIN' }],
        },
      });

      const result = await service.validateApiKey('cai_live_validkey');
      expect(result).toEqual({
        userId: 'admin-id',
        email: 'admin@org.com',
        organizationId: 'org-id',
        role: 'DEVELOPER',
      });
    });
  });
});

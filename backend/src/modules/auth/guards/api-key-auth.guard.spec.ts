import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { AuthService } from '../auth.service';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

describe('ApiKeyAuthGuard', () => {
  let guard: ApiKeyAuthGuard;
  let authService: AuthService;

  const mockAuthService = {
    validateApiKey: jest.fn(),
  };

  const createMockContext = (headers: Record<string, string>): ExecutionContext => {
    const request = { headers };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyAuthGuard,
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    guard = module.get<ApiKeyAuthGuard>(ApiKeyAuthGuard);
    authService = module.get<AuthService>(AuthService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should throw UnauthorizedException if X-API-Key header is missing', async () => {
      const context = createMockContext({});

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Missing X-API-Key header'),
      );
    });

    it('should throw UnauthorizedException if API key is invalid', async () => {
      const context = createMockContext({ 'x-api-key': 'invalid-key' });
      mockAuthService.validateApiKey.mockResolvedValueOnce(null);

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid or revoked API key'),
      );
      expect(authService.validateApiKey).toHaveBeenCalledWith('invalid-key');
    });

    it('should attach user context to request and return true if API key is valid', async () => {
      const context = createMockContext({ 'x-api-key': 'valid-key' });
      const userContext = { userId: 'admin-id', organizationId: 'org-id', role: 'DEVELOPER' };
      mockAuthService.validateApiKey.mockResolvedValueOnce(userContext);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      const request = context.switchToHttp().getRequest();
      expect(request.user).toEqual(userContext);
    });
  });
});

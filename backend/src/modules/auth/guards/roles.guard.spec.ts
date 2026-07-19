import { Test, TestingModule } from '@nestjs/testing';
import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const createMockContext = (user?: { role?: string }): ExecutionContext => {
    const request = { user };
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should return true if no roles are defined on target', () => {
      mockReflector.getAllAndOverride.mockReturnValue(null);
      const context = createMockContext();

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should throw ForbiddenException if user context is missing from request', () => {
      mockReflector.getAllAndOverride.mockReturnValue(['ADMIN']);
      const context = createMockContext(undefined);

      expect(() => guard.canActivate(context)).toThrow(
        new ForbiddenException('Access denied: No authenticated user context'),
      );
    });

    it('should throw ForbiddenException if user has a different role', () => {
      mockReflector.getAllAndOverride.mockReturnValue(['ADMIN']);
      const context = createMockContext({ role: 'OPERATOR' });

      expect(() => guard.canActivate(context)).toThrow(
        new ForbiddenException("Access denied: Requires one of roles [ADMIN], but user has role 'OPERATOR'"),
      );
    });

    it('should return true if user has one of required roles', () => {
      mockReflector.getAllAndOverride.mockReturnValue(['ADMIN', 'DEVELOPER']);
      const context = createMockContext({ role: 'DEVELOPER' });

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });
  });
});

import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StructuredLogger } from '../../common/logger/logger.service';
import { hashPassword, comparePassword, generateApiKey, hashApiKey } from '../../common/utils/crypto.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface JwtPayload {
  sub: string;       // userId
  email: string;
  organizationId: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly logger: StructuredLogger,
  ) {
    this.logger.setContext('AuthService');
  }

  /**
   * Register a new user and organization
   */
  async register(dto: RegisterDto) {
    this.logger.log(`Registration attempt for email: ${dto.email}`);

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    // Hash password
    const passwordHash = await hashPassword(dto.password);

    // Create organization and user in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: dto.organizationName },
      });

      await tx.organizationSettings.create({
        data: {
          organizationId: organization.id,
          recordingEnabled: true,
          defaultLanguage: 'en-US',
        },
      });

      await tx.billing.create({
        data: {
          organizationId: organization.id,
          balance: 0,
          currency: 'USD',
        },
      });

      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          role: 'ADMIN', // First user in an org is always ADMIN
          organizationId: organization.id,
        },
      });

      return { user, organization };
    });

    this.logger.log(`User registered successfully: ${result.user.id} in org: ${result.organization.id}`);

    // Generate JWT
    const token = this.generateToken(result.user);

    return {
      accessToken: token,
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        organizationId: result.organization.id,
        organizationName: result.organization.name,
      },
    };
  }

  /**
   * Authenticate user with email and password
   */
  async login(dto: LoginDto) {
    this.logger.log(`Login attempt for email: ${dto.email}`);

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { organization: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await comparePassword(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const token = this.generateToken(user);

    this.logger.log(`User logged in successfully: ${user.id}`);

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        organizationName: user.organization.name,
      },
    };
  }

  /**
   * Validate an API key and return the associated organization context
   */
  async validateApiKey(rawKey: string) {
    const keyHash = hashApiKey(rawKey);

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        organization: {
          include: {
            users: {
              where: { role: 'ADMIN' },
              take: 1,
            },
          },
        },
      },
    });

    if (!apiKey || !apiKey.isActive) {
      return null;
    }

    // Return a user-like context from the API key's org
    const adminUser = apiKey.organization.users[0];
    return {
      userId: adminUser?.id || 'api-key-user',
      email: adminUser?.email || 'api@callai.com',
      organizationId: apiKey.organizationId,
      role: 'DEVELOPER', // API keys operate at DEVELOPER role
    };
  }

  /**
   * Get user profile by ID
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: user.organization.name,
      createdAt: user.createdAt,
    };
  }

  private generateToken(user: { id: string; email: string; organizationId: string; role: string }): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      organizationId: user.organizationId,
      role: user.role,
    };

    return this.jwtService.sign(payload);
  }
}

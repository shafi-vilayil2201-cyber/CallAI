import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StructuredLogger } from '../../common/logger/logger.service';
import { generateApiKey } from '../../common/utils/crypto.util';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLogger,
  ) {
    this.logger.setContext('ApiKeysService');
  }

  /**
   * Generate a new API key. Returns the raw key ONCE — it's hashed for storage.
   */
  async create(name: string, organizationId: string) {
    const { rawKey, keyHash } = generateApiKey();

    const apiKey = await this.prisma.apiKey.create({
      data: {
        name,
        keyHash,
        organizationId,
        isActive: true,
      },
    });

    this.logger.log(`API key created: ${apiKey.id} for org ${organizationId}`);

    return {
      id: apiKey.id,
      name: apiKey.name,
      key: rawKey, // Returned ONCE — cannot be retrieved again
      createdAt: apiKey.createdAt,
    };
  }

  /**
   * List all API keys for an org (masked — no raw keys)
   */
  async findAll(organizationId: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return keys;
  }

  /**
   * Revoke (deactivate) an API key
   */
  async revoke(id: string, organizationId: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });

    if (!key || key.organizationId !== organizationId) {
      throw new NotFoundException(`API key ${id} not found`);
    }

    await this.prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.log(`API key ${id} revoked`);
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StructuredLogger } from '../../common/logger/logger.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';
import { TenantIsolationGuard } from '../../common/guards/tenant-isolation.guard';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLogger,
  ) {
    this.logger.setContext('WebhooksService');
  }

  async create(dto: CreateWebhookDto, organizationId: string) {
    return this.prisma.webhook.create({
      data: {
        name: dto.name,
        url: dto.url,
        secret: dto.secret,
        eventTypes: dto.eventTypes,
        organizationId,
        isActive: true,
      },
    });
  }

  async findAll(organizationId: string) {
    return this.prisma.webhook.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        url: true,
        eventTypes: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, dto: UpdateWebhookDto, organizationId: string) {
    const webhook = await this.prisma.webhook.findUnique({ where: { id } });
    if (!webhook) throw new NotFoundException(`Webhook ${id} not found`);
    TenantIsolationGuard.ensureTenantAccess(organizationId, webhook.organizationId);

    return this.prisma.webhook.update({
      where: { id },
      data: { ...dto },
    });
  }

  async remove(id: string, organizationId: string) {
    const webhook = await this.prisma.webhook.findUnique({ where: { id } });
    if (!webhook) throw new NotFoundException(`Webhook ${id} not found`);
    TenantIsolationGuard.ensureTenantAccess(organizationId, webhook.organizationId);

    await this.prisma.webhook.delete({ where: { id } });
  }
}

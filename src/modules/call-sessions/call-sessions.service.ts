import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StructuredLogger } from '../../common/logger/logger.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { TenantIsolationGuard } from '../../common/guards/tenant-isolation.guard';

@Injectable()
export class CallSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLogger,
  ) {
    this.logger.setContext('CallSessionsService');
  }

  async findAll(organizationId: string, query: PaginationQueryDto & { status?: string; assistantId?: string }) {
    const { page, limit, sortBy, sortOrder, status, assistantId } = query;
    const skip = (page - 1) * limit;

    const where: any = { organizationId };
    if (status) where.status = status;
    if (assistantId) where.assistantId = assistantId;

    const [data, total] = await Promise.all([
      this.prisma.callSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy || 'createdAt']: sortOrder },
        include: {
          assistant: { select: { name: true, voiceId: true, model: true } },
          callCost: { select: { totalCost: true, revenue: true, currency: true } },
        },
      }),
      this.prisma.callSession.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, limit);
  }

  async findOne(id: string, organizationId: string) {
    const session = await this.prisma.callSession.findUnique({
      where: { id },
      include: {
        assistant: { select: { name: true, voiceId: true, model: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        callCost: true,
      },
    });

    if (!session) {
      throw new NotFoundException(`Call session ${id} not found`);
    }

    TenantIsolationGuard.ensureTenantAccess(organizationId, session.organizationId);
    return session;
  }
}

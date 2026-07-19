import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StructuredLogger } from '../../common/logger/logger.service';
import { CreateAssistantDto, UpdateAssistantDto } from './dto/assistant.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { TenantIsolationGuard } from '../../common/guards/tenant-isolation.guard';

@Injectable()
export class AssistantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLogger,
  ) {
    this.logger.setContext('AssistantsService');
  }

  async create(dto: CreateAssistantDto, organizationId: string) {
    this.logger.log(`Creating assistant "${dto.name}" for org ${organizationId}`);

    return this.prisma.assistant.create({
      data: {
        name: dto.name,
        systemInstruction: dto.systemInstruction,
        voiceId: dto.voiceId,
        model: dto.model,
        language: dto.language,
        isPublished: dto.isPublished ?? false,
        organizationId,
        aiProviderConfigId: dto.aiProviderConfigId,
      },
    });
  }

  async findAll(organizationId: string, query: PaginationQueryDto) {
    const { page, limit, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.assistant.findMany({
        where: { organizationId },
        skip,
        take: limit,
        orderBy: { [sortBy || 'createdAt']: sortOrder },
      }),
      this.prisma.assistant.count({ where: { organizationId } }),
    ]);

    return new PaginatedResponseDto(data, total, page, limit);
  }

  async findOne(id: string, organizationId: string) {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id },
      include: { aiProviderConfig: { select: { providerName: true } } },
    });

    if (!assistant) {
      throw new NotFoundException(`Assistant ${id} not found`);
    }

    TenantIsolationGuard.ensureTenantAccess(organizationId, assistant.organizationId);
    return assistant;
  }

  async update(id: string, dto: UpdateAssistantDto, organizationId: string) {
    await this.findOne(id, organizationId); // Validates existence + tenant access

    return this.prisma.assistant.update({
      where: { id },
      data: { ...dto },
    });
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);

    await this.prisma.assistant.delete({ where: { id } });
    this.logger.log(`Assistant ${id} deleted`);
  }
}

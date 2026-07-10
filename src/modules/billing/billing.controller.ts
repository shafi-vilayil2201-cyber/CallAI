import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { IsOptional, IsString } from 'class-validator';

class BillingQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('usage')
  async getUsage(@Query() query: BillingQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const where: any = { organizationId: user.organizationId };

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const usages = await this.prisma.usage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Aggregate totals
    const totalCost = usages.reduce((sum, u) => sum + u.cost, 0);
    const totalQuantity = usages.reduce((sum, u) => sum + u.quantity, 0);

    return {
      items: usages,
      summary: {
        totalCost: Math.round(totalCost * 10000) / 10000,
        totalRecords: usages.length,
      },
    };
  }

  @Get('invoices')
  async getInvoices(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.invoice.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('subscription')
  async getSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.subscription.findUnique({
      where: { organizationId: user.organizationId },
    });
  }

  @Get('balance')
  async getBalance(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.billing.findUnique({
      where: { organizationId: user.organizationId },
      select: { balance: true, currency: true },
    });
  }
}

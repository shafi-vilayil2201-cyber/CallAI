import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { IsOptional, IsString, IsBoolean, MaxLength } from 'class-validator';

class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

class UpdateOrgSettingsDto {
  @IsOptional()
  @IsBoolean()
  recordingEnabled?: boolean;

  @IsOptional()
  @IsString()
  defaultLanguage?: string;
}

@Controller('organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async getOrg(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      include: { settings: true, subscription: true },
    });
  }

  @Patch('me')
  @Roles('ADMIN')
  async updateOrg(@Body() dto: UpdateOrganizationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.prisma.organization.update({
      where: { id: user.organizationId },
      data: { name: dto.name },
    });
  }

  @Get('me/settings')
  async getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.organizationSettings.findUnique({
      where: { organizationId: user.organizationId },
    });
  }

  @Patch('me/settings')
  @Roles('ADMIN')
  async updateSettings(@Body() dto: UpdateOrgSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.prisma.organizationSettings.update({
      where: { organizationId: user.organizationId },
      data: { ...dto },
    });
  }
}

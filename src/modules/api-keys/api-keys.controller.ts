import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { IsString, MinLength } from 'class-validator';

class CreateApiKeyDto {
  @IsString()
  @MinLength(2)
  name!: string;
}

@Controller('api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.apiKeysService.create(dto.name, user.organizationId);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.apiKeysService.findAll(user.organizationId);
  }

  @Delete(':id')
  revoke(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.apiKeysService.revoke(id, user.organizationId);
  }
}

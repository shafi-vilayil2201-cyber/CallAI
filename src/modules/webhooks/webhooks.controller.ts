import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@Controller('webhooks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'DEVELOPER')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  create(@Body() dto: CreateWebhookDto, @CurrentUser() user: AuthenticatedUser) {
    return this.webhooksService.create(dto, user.organizationId);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.webhooksService.findAll(user.organizationId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWebhookDto, @CurrentUser() user: AuthenticatedUser) {
    return this.webhooksService.update(id, dto, user.organizationId);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.webhooksService.remove(id, user.organizationId);
  }
}

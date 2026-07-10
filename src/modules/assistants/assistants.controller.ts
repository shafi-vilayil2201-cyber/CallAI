import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AssistantsService } from './assistants.service';
import { CreateAssistantDto, UpdateAssistantDto } from './dto/assistant.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@Controller('assistants')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssistantsController {
  constructor(private readonly assistantsService: AssistantsService) {}

  @Post()
  @Roles('ADMIN', 'DEVELOPER')
  create(@Body() dto: CreateAssistantDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assistantsService.create(dto, user.organizationId);
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assistantsService.findAll(user.organizationId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assistantsService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'DEVELOPER')
  update(@Param('id') id: string, @Body() dto: UpdateAssistantDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assistantsService.update(id, dto, user.organizationId);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assistantsService.remove(id, user.organizationId);
  }
}

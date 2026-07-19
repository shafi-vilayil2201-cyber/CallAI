import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CallSessionsService } from './call-sessions.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { IsOptional, IsString } from 'class-validator';

class CallSessionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  assistantId?: string;
}

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallSessionsController {
  constructor(private readonly callSessionsService: CallSessionsService) {}

  @Get()
  findAll(@Query() query: CallSessionsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.callSessionsService.findAll(user.organizationId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.callSessionsService.findOne(id, user.organizationId);
  }
}

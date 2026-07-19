import { Module } from '@nestjs/common';
import { CallSessionsController } from './call-sessions.controller';
import { CallSessionsService } from './call-sessions.service';

@Module({
  controllers: [CallSessionsController],
  providers: [CallSessionsService],
  exports: [CallSessionsService],
})
export class CallSessionsModule {}

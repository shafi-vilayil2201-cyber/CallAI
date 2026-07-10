import { Module } from '@nestjs/common';
import { ToolEngineService } from './tool-engine.service';

@Module({
  providers: [ToolEngineService],
  exports: [ToolEngineService],
})
export class ToolEngineModule {}

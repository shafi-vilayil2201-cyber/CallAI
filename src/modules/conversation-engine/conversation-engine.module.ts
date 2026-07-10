import { Module } from '@nestjs/common';
import { ConversationEngineService } from './conversation-engine.service';
import { AiOrchestratorModule } from '../ai-orchestrator/ai-orchestrator.module';
import { MemoryModule } from '../memory/memory.module';
import { ToolEngineModule } from '../tool-engine/tool-engine.module';

@Module({
  imports: [AiOrchestratorModule, MemoryModule, ToolEngineModule],
  providers: [ConversationEngineService],
  exports: [ConversationEngineService],
})
export class ConversationEngineModule {}

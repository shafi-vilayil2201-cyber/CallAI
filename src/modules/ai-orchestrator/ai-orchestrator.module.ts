import { Module } from '@nestjs/common';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { OpenAiRealtimeProvider } from './providers/openai-realtime.provider';

@Module({
  providers: [AiOrchestratorService, OpenAiRealtimeProvider],
  exports: [AiOrchestratorService, OpenAiRealtimeProvider],
})
export class AiOrchestratorModule {}

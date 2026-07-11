import { Module } from '@nestjs/common';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { OpenAiRealtimeProvider } from './providers/openai-realtime.provider';
import { GeminiLiveProvider } from './providers/gemini-live.provider';

@Module({
  providers: [AiOrchestratorService, OpenAiRealtimeProvider, GeminiLiveProvider],
  exports: [AiOrchestratorService, OpenAiRealtimeProvider, GeminiLiveProvider],
})
export class AiOrchestratorModule {}

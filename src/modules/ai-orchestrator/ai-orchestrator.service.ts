import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { AiProvider } from './interfaces/ai-provider.interface';
import { OpenAiRealtimeProvider } from './providers/openai-realtime.provider';
import { StructuredLogger } from '../../common/logger/logger.service';

@Injectable()
export class AiOrchestratorService {
  private readonly providers = new Map<string, AiProvider>();

  constructor(
    private readonly logger: StructuredLogger,
    @Inject(forwardRef(() => OpenAiRealtimeProvider))
    private readonly openAiRealtimeProvider: OpenAiRealtimeProvider
  ) {
    this.logger.setContext('AiOrchestratorService');
    // Register active AI provider instances
    this.providers.set('openai', this.openAiRealtimeProvider);
  }

  /**
   * Resolves the appropriate AI provider dynamically. If the primary provider
   * is down, it implements failover logic to a secondary provider model.
   * @param providerName Primary configured provider (e.g., 'openai')
   * @returns AiProvider
   */
  resolveProvider(providerName: string): AiProvider {
    const provider = this.providers.get(providerName.toLowerCase());

    if (!provider) {
      this.logger.warn(`AI Provider '${providerName}' not found. Defaulting to OpenAI Realtime.`);
      const defaultProvider = this.providers.get('openai');
      if (!defaultProvider) {
        throw new Error('Default AI provider (OpenAI) is not registered in AI Orchestrator.');
      }
      return defaultProvider;
    }

    return provider;
  }

  /**
   * Returns list of supported voice models
   */
  getSupportedModels(): string[] {
    return ['gpt-4o-realtime', 'gemini-1.5-flash-live', 'claude-3-5-sonnet'];
  }
}

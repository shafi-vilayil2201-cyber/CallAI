import { Injectable } from '@nestjs/common';
import { trace, context, Span, Meter, metrics } from '@opentelemetry/api';
import { StructuredLogger } from '../logger/logger.service';

@Injectable()
export class ObservabilityService {
  private readonly meter: Meter;

  // Custom metrics counters
  private readonly callsStartedCounter;
  private readonly callsEndedCounter;
  private readonly audioChunksProcessedCounter;
  private readonly latencyHistogram;
  private readonly tokenUsageCounter;

  constructor(private readonly logger: StructuredLogger) {
    this.logger.setContext('Observability');
    this.meter = metrics.getMeter('call-ai-meter');

    // Create Prometheus/OpenTelemetry metrics
    this.callsStartedCounter = this.meter.createCounter('callai_calls_started_total', {
      description: 'Total number of call sessions started',
    });
    
    this.callsEndedCounter = this.meter.createCounter('callai_calls_ended_total', {
      description: 'Total number of call sessions ended',
    });

    this.audioChunksProcessedCounter = this.meter.createCounter('callai_audio_chunks_processed_total', {
      description: 'Total number of audio chunks processed in streaming gateways',
    });

    this.latencyHistogram = this.meter.createHistogram('callai_turn_latency_ms', {
      description: 'Histogram of conversational turn latency in milliseconds',
      unit: 'ms',
    });

    this.tokenUsageCounter = this.meter.createCounter('callai_ai_tokens_total', {
      description: 'Count of tokens utilized by AI model execution',
    });
  }

  // Active call counters
  recordCallStart(organizationId: string, assistantId: string) {
    this.callsStartedCounter.add(1, { organizationId, assistantId });
  }

  recordCallEnd(organizationId: string, assistantId: string) {
    this.callsEndedCounter.add(1, { organizationId, assistantId });
  }

  recordAudioChunk(provider: string) {
    this.audioChunksProcessedCounter.add(1, { provider });
  }

  recordTurnLatency(latencyMs: number, organizationId: string, model: string) {
    this.latencyHistogram.record(latencyMs, { organizationId, model });
    this.logger.log(`Turn Latency recorded: ${latencyMs}ms for tenant ${organizationId}`);
  }

  recordTokenUsage(promptTokens: number, completionTokens: number, organizationId: string, model: string) {
    this.tokenUsageCounter.add(promptTokens, { type: 'prompt', organizationId, model });
    this.tokenUsageCounter.add(completionTokens, { type: 'completion', organizationId, model });
  }

  // Create customized trace span
  startSpan(name: string): Span {
    const tracer = trace.getTracer('call-ai-tracer');
    return tracer.startSpan(name);
  }

  recordErrorOnSpan(span: Span, error: Error) {
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message }); // 2 = Error status
  }
}

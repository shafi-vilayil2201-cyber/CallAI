import { Injectable } from '@nestjs/common';
import * as WebSocket from 'ws';
import { ConfigService } from '@nestjs/config';
import { AiProvider, AssistantConfig, AiProviderCallbacks } from '../interfaces/ai-provider.interface';
import { StructuredLogger } from '../../../common/logger/logger.service';

@Injectable()
export class OpenAiRealtimeProvider implements AiProvider {
  private socket: WebSocket | null = null;
  private isWsConnected = false;
  private currentCallbacks: AiProviderCallbacks | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: StructuredLogger
  ) {
    this.logger.setContext('OpenAiRealtimeProvider');
  }

  async connect(config: AssistantConfig, callbacks: AiProviderCallbacks): Promise<void> {
    this.logger.log(`Establishing connection to OpenAI Realtime API using model: ${config.model}`);
    this.currentCallbacks = callbacks;

    const apiKey = this.configService.get<string>('OPENAI_API_KEY', '');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not defined in the environment configurations.');
    }

    const url = `wss://api.openai.com/v1/realtime?model=${config.model}`;
    
    this.socket = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('WebSocket creation failed.'));

      this.socket.on('open', () => {
        this.isWsConnected = true;
        this.logger.log('Connected to OpenAI Realtime WebSocket successfully.');
        
        // Initial Session Configuration
        this.configureSession(config);
        resolve();
      });

      this.socket.on('message', (data: WebSocket.Data) => {
        this.handleIncomingMessage(data);
      });

      this.socket.on('error', (error) => {
        this.logger.error('OpenAI Realtime connection error encountered', error.stack);
        if (callbacks.onError) callbacks.onError(error);
        reject(error);
      });

      this.socket.on('close', (code, reason) => {
        this.isWsConnected = false;
        this.logger.log(`OpenAI Realtime connection closed. Code: ${code}, Reason: ${reason.toString()}`);
      });
    });
  }

  async sendAudioChunk(chunk: Buffer): Promise<void> {
    if (!this.isConnected()) {
      this.logger.warn('Attempted to send audio chunk while socket is disconnected.');
      return;
    }

    // Convert raw binary buffer to base64 audio stream chunk
    const base64Audio = chunk.toString('base64');
    const event = {
      type: 'input_audio_buffer.append',
      audio: base64Audio,
    };

    this.socket?.send(JSON.stringify(event));
  }

  async sendTextMessage(text: string): Promise<void> {
    if (!this.isConnected()) return;

    const event = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text,
          },
        ],
      },
    };

    this.socket?.send(JSON.stringify(event));
    
    // Request a model response
    this.socket?.send(JSON.stringify({ type: 'response.create' }));
  }

  async cancelResponse(): Promise<void> {
    if (!this.isConnected()) return;

    this.logger.log('Sending cancellation request to OpenAI Realtime session (Barge-In).');

    // 1. Cancel active generation response
    this.socket?.send(JSON.stringify({
      type: 'response.cancel'
    }));

    // 2. Clear input buffers
    this.socket?.send(JSON.stringify({
      type: 'input_audio_buffer.clear'
    }));
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.isWsConnected = false;
  }

  isConnected(): boolean {
    return this.isWsConnected && this.socket?.readyState === WebSocket.OPEN;
  }

  private configureSession(config: AssistantConfig) {
    if (!this.socket) return;

    const openaiTools = config.tools?.map(tool => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })) || [];

    const sessionUpdate = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: config.systemInstruction,
        voice: config.voiceId, // e.g. "alloy", "shimmer", "echo"
        input_audio_format: 'g711_ulaw', // Native telephony support!
        output_audio_format: 'g711_ulaw',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500, // 500ms silence = user ended turn
        },
        tools: openaiTools,
        tool_choice: 'auto',
      },
    };

    this.socket.send(JSON.stringify(sessionUpdate));
  }

  private handleIncomingMessage(data: WebSocket.Data) {
    try {
      const event = JSON.parse(data.toString());

      switch (event.type) {
        case 'response.audio.delta':
          if (event.delta && this.currentCallbacks?.onAudioChunk) {
            const buffer = Buffer.from(event.delta, 'base64');
            this.currentCallbacks.onAudioChunk(buffer);
          }
          break;

        case 'response.audio_transcript.delta':
          if (event.delta && this.currentCallbacks?.onTextDelta) {
            this.currentCallbacks.onTextDelta(event.delta);
          }
          break;

        case 'input_audio_buffer.speech_started':
          this.logger.log('OpenAI detected user speech starting (VAD).');
          if (this.currentCallbacks?.onSpeechStarted) {
            this.currentCallbacks.onSpeechStarted();
          }
          break;

        case 'input_audio_buffer.speech_stopped':
          this.logger.log('OpenAI detected user speech stopped (VAD).');
          if (this.currentCallbacks?.onSpeechStopped) {
            this.currentCallbacks.onSpeechStopped();
          }
          break;

        case 'response.created':
          if (this.currentCallbacks?.onResponseStarted) {
            this.currentCallbacks.onResponseStarted();
          }
          break;

        case 'response.function_call_arguments.done':
          if (event.name && this.currentCallbacks?.onToolCall) {
            this.logger.log(`OpenAI requested tool execution: ${event.name} with call ID: ${event.call_id}`);
            const args = event.arguments ? JSON.parse(event.arguments) : {};
            
            this.currentCallbacks.onToolCall(event.name, args, event.call_id)
              .then((result) => {
                this.logger.log(`Tool ${event.name} execution succeeded. Submitting result...`);
                this.socket?.send(JSON.stringify({
                  type: 'conversation.item.create',
                  item: {
                    type: 'function_call_output',
                    call_id: event.call_id,
                    output: result,
                  },
                }));
                // Request a response to summarize the output
                this.socket?.send(JSON.stringify({ type: 'response.create' }));
              })
              .catch((err) => {
                this.logger.error(`Tool ${event.name} execution failed`, err instanceof Error ? err.stack : undefined);
                const errorResult = JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown tool error' });
                this.socket?.send(JSON.stringify({
                  type: 'conversation.item.create',
                  item: {
                    type: 'function_call_output',
                    call_id: event.call_id,
                    output: errorResult,
                  },
                }));
                this.socket?.send(JSON.stringify({ type: 'response.create' }));
              });
          }
          break;

        case 'response.done':
          if (event.response && this.currentCallbacks?.onResponseCompleted) {
            const outputItem = event.response.output?.[0];
            const transcript = outputItem?.content?.[0]?.transcript || '';
            const usage = event.response.usage;
            
            this.currentCallbacks.onResponseCompleted(
              transcript,
              usage?.input_tokens || 0,
              usage?.output_tokens || 0
            );
          }
          break;

        case 'error':
          this.logger.error(`OpenAI error event: ${JSON.stringify(event.error)}`);
          if (this.currentCallbacks?.onError) {
            this.currentCallbacks.onError(new Error(event.error?.message || 'OpenAI error'));
          }
          break;
      }
    } catch (err) {
      this.logger.error('Failed to parse incoming OpenAI Realtime WebSocket message', err instanceof Error ? err.stack : undefined);
    }
  }
}

import { Injectable } from '@nestjs/common';
import * as WebSocket from 'ws';
import { ConfigService } from '@nestjs/config';
import { AiProvider, AssistantConfig, AiProviderCallbacks } from '../interfaces/ai-provider.interface';
import { StructuredLogger } from '../../../common/logger/logger.service';

@Injectable()
export class GeminiLiveProvider implements AiProvider {
  private socket: WebSocket | null = null;
  private isWsConnected = false;
  private disconnectLogged = false;
  private currentCallbacks: AiProviderCallbacks | null = null;
  private currentSessionConfig: AssistantConfig | null = null;
  
  // Track conversational states for callbacks
  private accumulatedTranscript = '';
  private lastPromptTokens = 0;
  private lastCompletionTokens = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: StructuredLogger
  ) {
    this.logger.setContext('GeminiLiveProvider');
  }

  async connect(config: AssistantConfig, callbacks: AiProviderCallbacks): Promise<void> {
    this.logger.log(`Establishing connection to Gemini Multimodal Live API using model: ${config.model}`);
    this.currentCallbacks = callbacks;
    this.currentSessionConfig = config;
    this.accumulatedTranscript = '';
    this.lastPromptTokens = 0;
    this.lastCompletionTokens = 0;
    this.disconnectLogged = false;

    const apiKey = this.configService.get<string>('GEMINI_API_KEY', '');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in the environment configurations.');
    }

    // Connect to Google Gemini Live API endpoint
    // Standard endpoint: BidiGenerateContent
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    
    this.socket = new WebSocket(url);

    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('WebSocket creation failed.'));

      this.socket.on('open', () => {
        this.isWsConnected = true;
        this.logger.log('Connected to Gemini Multimodal Live WebSocket successfully.');
        
        // Send session initialization configuration
        this.sendSetupConfig(config);
        resolve();
      });

      this.socket.on('message', (data: WebSocket.Data) => {
        this.handleIncomingMessage(data);
      });

      this.socket.on('close', (code, reason) => {
        this.isWsConnected = false;
        this.disconnectLogged = false;
        const reasonStr = reason ? reason.toString() : 'No reason specified';
        this.logger.warn(`Gemini Multimodal Live connection closed. Code: ${code}, Reason: ${reasonStr}`);
        if (this.currentCallbacks?.onError) {
          this.currentCallbacks.onError(new Error(`Gemini WS closed: ${code} - ${reasonStr}`));
        }
      });

      this.socket.on('error', (error) => {
        this.logger.error('Gemini Multimodal Live connection error:', error.stack);
        if (this.currentCallbacks?.onError) {
          this.currentCallbacks.onError(error);
        }
        reject(error);
      });
    });
  }

  async sendAudioChunk(chunk: Buffer): Promise<void> {
    if (!this.isConnected()) {
      if (!this.disconnectLogged) {
        this.disconnectLogged = true;
        this.logger.warn('Gemini socket disconnected — suppressing further audio-chunk warnings for this session.');
      }
      return;
    }

    // Stream audio chunk as realtimeInput in PCM16 (at 16kHz)
    const event = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: chunk.toString('base64'),
          },
        ],
      },
    };

    this.socket?.send(JSON.stringify(event));
  }

  async sendTextMessage(text: string): Promise<void> {
    if (!this.isConnected()) {
      this.logger.warn('Attempted to send text message while socket is disconnected.');
      return;
    }

    // Send text turn input to Gemini
    const event = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [
              {
                text: text,
              },
            ],
          },
        ],
        turnComplete: true,
      },
    };

    this.socket?.send(JSON.stringify(event));
  }

  async cancelResponse(): Promise<void> {
    // Gemini's server-side VAD handles interruptions automatically and pauses active audio stream generation.
    this.logger.log('Interruption request received. Gemini server VAD manages this natively.');
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

  private sendSetupConfig(config: AssistantConfig) {
    if (!this.socket) return;

    // Map OpenAI tools syntax to Gemini Tool declarations
    const functionDeclarations = config.tools?.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters, // standard JSON schema format matches directly
    })) || [];

    const geminiTools = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

    const setupMessage = {
      setup: {
        model: config.model.startsWith('models/') ? config.model : `models/${config.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.mapVoiceId(config.voiceId),
              },
            },
          },
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
        systemInstruction: {
          parts: [
            {
              text: config.systemInstruction,
            },
          ],
        },
        tools: geminiTools,
      },
    };

    this.socket.send(JSON.stringify(setupMessage));
    this.logger.log(`Session setup config sent for voice: ${config.voiceId} (${this.mapVoiceId(config.voiceId)})`);
  }

  private mapVoiceId(voiceId: string): string {
    const map: Record<string, string> = {
      alloy: 'Aoede',
      echo: 'Charon',
      fable: 'Fenrir',
      onyx: 'Kore',
      nova: 'Puck',
      shimmer: 'Aoede',
    };
    return map[voiceId.toLowerCase()] || 'Aoede';
  }

  private async handleIncomingMessage(data: WebSocket.Data) {
    try {
      const event = JSON.parse(data.toString());

      // 1. Setup complete confirmation
      if (event.setupComplete) {
        this.logger.log('Gemini Live Session setup successfully completed.');
        if (this.currentCallbacks?.onResponseStarted) {
          this.currentCallbacks.onResponseStarted();
        }
        return;
      }

      // 2. Token usage metadata
      if (event.usageMetadata) {
        this.lastPromptTokens = event.usageMetadata.promptTokenCount || this.lastPromptTokens;
        this.lastCompletionTokens = event.usageMetadata.candidatesTokenCount || this.lastCompletionTokens;
      }

      // 3. Server content stream (Text + Audio output)
      if (event.serverContent) {
        const { modelTurn, turnComplete, interrupted } = event.serverContent;

        if (modelTurn?.parts) {
          for (const part of modelTurn.parts) {
            // Text output / transcript
            if (part.text && this.currentCallbacks?.onTextDelta) {
              this.accumulatedTranscript += part.text;
              this.currentCallbacks.onTextDelta(part.text);
            }

            // Audio output stream chunk (PCM16 24kHz)
            if (part.inlineData && part.inlineData.data && this.currentCallbacks?.onAudioChunk) {
              const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
              this.currentCallbacks.onAudioChunk(audioBuffer);
            }
          }
        }

        // Interrupted by speech start
        if (interrupted && this.currentCallbacks?.onSpeechStarted) {
          this.logger.log('Interruption detected by Gemini server.');
          this.currentCallbacks.onSpeechStarted();
        }

        // Turn completed
        if (turnComplete && this.currentCallbacks?.onResponseCompleted) {
          this.currentCallbacks.onResponseCompleted(
            this.accumulatedTranscript,
            this.lastPromptTokens,
            this.lastCompletionTokens
          );
          // Reset transcript accumulator for next turn
          this.accumulatedTranscript = '';
        }
      }

      // 4. Voice Activity Detection (VAD) events from Gemini server VAD
      if (event.voiceActivity) {
        const { activity } = event.voiceActivity;
        if (activity === 'SPEECH_STARTED' && this.currentCallbacks?.onSpeechStarted) {
          this.logger.log('User speech start detected by server VAD.');
          this.currentCallbacks.onSpeechStarted();
        } else if (activity === 'SPEECH_ENDED' && this.currentCallbacks?.onSpeechStopped) {
          this.logger.log('User speech end detected by server VAD.');
          this.currentCallbacks.onSpeechStopped();
        }
      }

      // 5. Tool Call requests
      if (event.toolCall?.functionCalls) {
        for (const call of event.toolCall.functionCalls) {
          this.logger.log(`Received tool call from Gemini: ${call.name} (callId: ${call.id})`);
          
          if (this.currentCallbacks?.onToolCall) {
            try {
              const result = await this.currentCallbacks.onToolCall(call.name, call.args, call.id);
              
              // Send tool output back to Gemini
              const responseEvent = {
                toolResponse: {
                  functionResponses: [
                    {
                      response: {
                        output: {
                          result: result,
                        },
                      },
                      id: call.id,
                    },
                  ],
                },
              };
              
              this.socket?.send(JSON.stringify(responseEvent));
              this.logger.log(`Tool response sent back to Gemini for: ${call.name}`);
            } catch (err) {
              this.logger.error(`Error executing tool call: ${call.name}`, err.stack);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to parse Gemini Live incoming WebSocket message:', error.stack);
    }
  }
}

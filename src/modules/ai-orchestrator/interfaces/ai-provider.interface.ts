import { ToolDefinition } from '../../tool-engine/tool-engine.service';

export interface AiProviderCallbacks {
  onAudioChunk?: (chunk: Buffer) => void;
  onTextDelta?: (text: string) => void;
  onSpeechStarted?: () => void;
  onSpeechStopped?: () => void;
  onResponseStarted?: () => void;
  onResponseCompleted?: (transcript: string, promptTokens: number, completionTokens: number) => void;
  onError?: (error: Error) => void;
  onToolCall?: (name: string, args: Record<string, any>, callId: string) => Promise<string>;
}

export interface AssistantConfig {
  systemInstruction: string;
  voiceId: string;
  model: string;
  language: string;
  customSettings?: Record<string, any>;
  tools?: ToolDefinition[];
}

export interface AiProvider {
  /**
   * Connect to the AI Provider's real-time service (e.g. WebSocket connection)
   */
  connect(config: AssistantConfig, callbacks: AiProviderCallbacks): Promise<void>;

  /**
   * Send a raw audio stream buffer (e.g., PCM 16-bit 8kHz) to the provider
   */
  sendAudioChunk(chunk: Buffer): Promise<void>;

  /**
   * Sends a text message to prompt the AI model (e.g. to inject system commands or override context)
   */
  sendTextMessage(text: string): Promise<void>;

  /**
   * Cancels the active response execution (used for client interruptions/barge-in)
   */
  cancelResponse(): Promise<void>;

  /**
   * Terminate connection gracefully
   */
  disconnect(): Promise<void>;

  /**
   * Checks connection health state
   */
  isConnected(): boolean;
}

export const AI_PROVIDER = Symbol('AiProvider');

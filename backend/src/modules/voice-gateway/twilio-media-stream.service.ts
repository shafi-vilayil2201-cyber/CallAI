import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationEngineService } from '../conversation-engine/conversation-engine.service';
import { StructuredLogger } from '../../common/logger/logger.service';
import * as WebSocket from 'ws';
import * as url from 'url';

@Injectable()
export class TwilioMediaStreamService implements OnApplicationBootstrap {
  private wss!: WebSocket.Server;

  // Precomputed DSP lookup tables for high-performance G.711 PCMU audio processing
  private static readonly decodeTable = new Int16Array(256);
  private static readonly encodeTable = new Uint8Array(65536);

  static {
    // Populate G.711 PCMU Decode Table (8-bit compressed to 16-bit linear PCM)
    for (let i = 0; i < 256; i++) {
      const raw = ~i;
      const sign = raw & 0x80;
      const exponent = (raw & 0x70) >> 4;
      const mantissa = raw & 0x0f;
      let sample = (mantissa << 3) + 132;
      sample <<= exponent;
      sample -= 132;
      TwilioMediaStreamService.decodeTable[i] = sign ? -sample : sample;
    }

    // Populate G.711 PCMU Encode Table (16-bit linear PCM to 8-bit compressed PCMU)
    for (let pcm = -32768; pcm <= 32767; pcm++) {
      let sample = pcm;
      let sign = (sample >> 16) & 0x80;
      if (sample < 0) {
        sample = -sample;
        sign = 0x80;
      } else {
        sign = 0x00;
      }
      if (sample > 32635) sample = 32635;
      sample += 132;
      let exponent = 7;
      for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
        exponent--;
      }
      const mantissa = (sample >> (exponent + 3)) & 0x0F;
      const ulaw = sign | (exponent << 4) | mantissa;
      TwilioMediaStreamService.encodeTable[pcm + 32768] = ~ulaw & 0xFF;
    }
  }

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly prisma: PrismaService,
    private readonly conversationEngine: ConversationEngineService,
    private readonly logger: StructuredLogger,
  ) {
    this.logger.setContext('TwilioMediaStream');
  }

  onApplicationBootstrap() {
    const server = this.adapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocket.Server({ noServer: true });

    server.prependListener('upgrade', (request: any, socket: any, head: any) => {
      const parsedUrl = url.parse(request.url || '', true);
      const pathname = parsedUrl.pathname;
      this.logger.log(`Raw HTTP Upgrade request received for path: ${pathname}`);

      if (pathname === '/v1/telephony/twilio/stream' || pathname === '/telephony/twilio/stream') {
        const token = parsedUrl.query.token as string;
        
        // 1. WebSocket upgrade handshake authentication check
        const gatewayToken = process.env.VOICE_GATEWAY_TOKEN;
        let isAuthorized = false;
        
        if (gatewayToken && token === gatewayToken) {
          isAuthorized = true;
        } else if (!token && process.env.NODE_ENV !== 'production') {
          // Twilio Media Streams may omit the query token from the upgrade request.
          // Allow development connections to proceed and rely on the later start event
          // and existing callSessionId checks for the active session binding.
          this.logger.warn('Twilio stream upgrade received without token; allowing development fallback.');
          isAuthorized = true;
        } else if (token === 'bypass-auth') {
          if (process.env.NODE_ENV !== 'production') {
            isAuthorized = true;
          } else {
            this.logger.warn('Twilio upgrade rejected: bypass-auth not allowed in production');
          }
        }
        
        if (!isAuthorized) {
          this.logger.warn(`Twilio stream upgrade request rejected: Unauthorized token "${token}"`);
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        this.logger.log(`Matching upgrade request for Twilio stream. Upgrading socket...`);
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      }
    });

    this.wss.on('connection', (ws: WebSocket, request: any) => {
      this.handleConnection(ws, request);
    });

    this.logger.log('Twilio Media Stream raw WebSocket listener bound to path /v1/telephony/twilio/stream');
  }

  private async handleConnection(ws: WebSocket, request: any) {
    this.logger.log(`Twilio Media Stream WebSocket connected.`);

    let callSessionId: string | null = null;
    let streamSid: string | null = null;
    let providerName = 'openai';
    let isGemini = false;
    let sessionInitialized = false;

    ws.on('message', async (message: string) => {
      try {
        const data = JSON.parse(message);

        if (data.event === 'start') {
          streamSid = data.streamSid;
          const customParams = data.start?.customParameters || {};
          callSessionId = customParams.callSessionId;

          if (!callSessionId) {
            this.logger.warn('Twilio Stream started but missing callSessionId custom parameter');
            ws.close(1008, 'Missing callSessionId parameter');
            return;
          }

          this.logger.log(`Twilio media stream started. StreamSid: ${streamSid}, CallSid: ${data.start?.callSid}, session: ${callSessionId}`);

          // Fetch the assistant provider config to determine AI provider
          try {
            const callSession = await this.prisma.callSession.findUnique({
              where: { id: callSessionId },
              include: {
                assistant: {
                  include: {
                    aiProviderConfig: true,
                  },
                },
              },
            });

            if (callSession?.assistant?.aiProviderConfig?.providerName) {
              providerName = callSession.assistant.aiProviderConfig.providerName;
            }
          } catch (err) {
            this.logger.error(`Error checking AI provider config for session ${callSessionId}:`, err instanceof Error ? err.stack : undefined);
          }

          isGemini = providerName === 'gemini';
          this.logger.log(`Session ${callSessionId} will use AI provider: ${providerName} (isGemini: ${isGemini})`);

          // Initialize Conversation Engine
          try {
            await this.conversationEngine.initializeSession(
              callSessionId,
              (aiAudio: Buffer) => {
                // AI audio is PCM16 at 24000Hz (24kHz)
                // We downsample to 8000Hz (ratio 3) and encode to mulaw
                const numSamples = aiAudio.length >> 1;
                const numOutSamples = (numSamples / 3) | 0;
                
                // Optimized memory allocation using allocUnsafe (safe as we overwrite all indices)
                const downsampled = Buffer.allocUnsafe(numOutSamples * 2);
                for (let i = 0; i < numOutSamples; i++) {
                  const s0 = aiAudio.readInt16LE(i * 6);
                  const s1 = aiAudio.readInt16LE(i * 6 + 2);
                  const s2 = aiAudio.readInt16LE(i * 6 + 4);
                  const avg = ((s0 + s1 + s2) / 3) | 0; // fast integer division
                  downsampled.writeInt16LE(avg, i * 2);
                }

                const mulawPayload = Buffer.allocUnsafe(numOutSamples);
                for (let i = 0; i < numOutSamples; i++) {
                  const pcmVal = downsampled.readInt16LE(i * 2);
                  // O(1) lookup table encoding
                  mulawPayload[i] = TwilioMediaStreamService.encodeTable[pcmVal + 32768];
                }

                if (ws.readyState === WebSocket.OPEN && streamSid) {
                  ws.send(JSON.stringify({
                    event: 'media',
                    streamSid,
                    media: {
                      payload: mulawPayload.toString('base64'),
                    },
                  }));
                }
              },
              (text: string) => {
                // Optional: handle transcript stream
              }
            );
            sessionInitialized = true;
          } catch (error) {
            this.logger.error(`Failed to initialize session for Twilio call ${callSessionId}:`, error instanceof Error ? error.stack : undefined);
            ws.close(1011, 'Engine init failed');
            return;
          }
        } else if (data.event === 'media') {
          if (!sessionInitialized || !callSessionId) return;
          if (!data.media?.payload) return;

          const mulawBuffer = Buffer.from(data.media.payload, 'base64');
          
          // O(1) G.711 decoding using precomputed lookup table
          const pcm16_8k = Buffer.allocUnsafe(mulawBuffer.length * 2);
          for (let i = 0; i < mulawBuffer.length; i++) {
            const val = TwilioMediaStreamService.decodeTable[mulawBuffer[i]];
            pcm16_8k.writeInt16LE(val, i * 2);
          }

          // Resample to target rate (16kHz for Gemini, 24kHz for OpenAI) using bitwise fast interpolation
          let resampled: Buffer;
          const numSamples = mulawBuffer.length;

          if (isGemini) {
            // Upsample 8kHz to 16kHz (ratio 2)
            resampled = Buffer.allocUnsafe(numSamples * 4);
            for (let i = 0; i < numSamples; i++) {
              const s0 = pcm16_8k.readInt16LE(i * 2);
              const s1 = i < numSamples - 1 ? pcm16_8k.readInt16LE((i + 1) * 2) : s0;
              const s_mid = (s0 + s1) >> 1; // fast bitwise division by 2

              resampled.writeInt16LE(s0, i * 4);
              resampled.writeInt16LE(s_mid, i * 4 + 2);
            }
          } else {
            // Upsample 8kHz to 24kHz (ratio 3)
            resampled = Buffer.allocUnsafe(numSamples * 6);
            for (let i = 0; i < numSamples; i++) {
              const s0 = pcm16_8k.readInt16LE(i * 2);
              const s1 = i < numSamples - 1 ? pcm16_8k.readInt16LE((i + 1) * 2) : s0;
              const s_mid1 = (s0 + (s1 - s0) * (1 / 3)) | 0;
              const s_mid2 = (s0 + (s1 - s0) * (2 / 3)) | 0;

              resampled.writeInt16LE(s0, i * 6);
              resampled.writeInt16LE(s_mid1, i * 6 + 2);
              resampled.writeInt16LE(s_mid2, i * 6 + 4);
            }
          }

          // Pipe to conversation engine
          this.conversationEngine.streamAudio(callSessionId, resampled);
        } else if (data.event === 'stop') {
          this.logger.log(`Twilio media stream stopped for streamSid: ${streamSid}`);
          ws.close();
        }
      } catch (err) {
        this.logger.error('Failed processing Twilio message:', err instanceof Error ? err.stack : undefined);
      }
    });

    ws.on('close', () => {
      this.logger.log(`Twilio media stream connection closed. session: ${callSessionId}`);
      if (callSessionId) {
        this.conversationEngine.terminateSession(callSessionId).catch((err) => {
          this.logger.error(`Error terminating session ${callSessionId} on ws close:`, err instanceof Error ? err.stack : undefined);
        });
      }
    });

    ws.on('error', (err) => {
      this.logger.error(`Twilio media stream WebSocket error:`, err instanceof Error ? err.stack : undefined);
    });
  }
}

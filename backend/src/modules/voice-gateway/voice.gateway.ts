import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { StructuredLogger } from '../../common/logger/logger.service';
import { ConversationEngineService } from '../conversation-engine/conversation-engine.service';
import { ObservabilityService } from '../../common/observability/observability.service';

@WebSocketGateway({
  cors: { origin: '*' },
  path: '/v1/voice-stream',
})
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  // Active call connections map: callSessionId -> Socket
  private readonly activeSockets = new Map<string, Socket>();

  // Connection rate limiting: orgId -> { count, windowStart }
  private readonly connectionRates = new Map<string, { count: number; windowStart: number }>();
  private readonly MAX_CONNECTIONS_PER_ORG_PER_MIN = 10;

  constructor(
    private readonly logger: StructuredLogger,
    private readonly conversationEngine: ConversationEngineService,
    private readonly observability: ObservabilityService,
    private readonly jwtService: JwtService,
  ) {
    this.logger.setContext('VoiceGateway');
  }

  async handleConnection(client: Socket) {
    const { token, callSessionId } = client.handshake.query;

    this.logger.log(`New connection attempt on voice stream. Query params: callSessionId=${callSessionId}`);

    // 1. Connection Authentication & Validation
    if (!token || !callSessionId) {
      this.logger.warn('Connection rejected: Missing auth token or callSessionId');
      client.disconnect(true);
      return;
    }

    const tokenStr = Array.isArray(token) ? token[0] : token;

    // Authenticate: verify JWT token, or allow configured gateway token
    const authResult = await this.authenticateConnection(tokenStr);
    if (!authResult.valid) {
      this.logger.warn(`Connection rejected: ${authResult.reason}`);
      client.disconnect(true);
      return;
    }

    // 2. Connection rate limiting per organization
    if (authResult.organizationId) {
      if (!this.checkConnectionRateLimit(authResult.organizationId)) {
        this.logger.warn(`Connection rejected: Rate limit exceeded for org ${authResult.organizationId}`);
        client.disconnect(true);
        return;
      }
    }

    const sessionIdStr = Array.isArray(callSessionId) ? callSessionId[0] : callSessionId;
    this.activeSockets.set(sessionIdStr, client);

    this.logger.log(`Client authenticated. Voice session bound: ${sessionIdStr}`);
    this.observability.recordAudioChunk('inbound-stream');

    // 3. Initialize Conversation Engine for this call session
    try {
      await this.conversationEngine.initializeSession(
        sessionIdStr,
        (aiAudio: Buffer) => {
          // Send synthesized AI audio packets back to telephony carrier client
          client.emit('audio-out', {
            payload: aiAudio.toString('base64'),
            timestamp: Date.now(),
          });
        },
        (text: string) => {
          // Send text transcript stream delta back to web client
          client.emit('audio-out-transcript', text);
        }
      );
    } catch (error) {
      this.logger.error(`Failed to initialize AI conversation for call ${sessionIdStr}`, error instanceof Error ? error.stack : undefined);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const { callSessionId } = client.handshake.query;
    const sessionIdStr = Array.isArray(callSessionId) ? callSessionId[0] : callSessionId;

    if (sessionIdStr) {
      this.activeSockets.delete(sessionIdStr);
      this.conversationEngine.terminateSession(sessionIdStr);
      this.logger.log(`Voice session closed: ${sessionIdStr}`);
    }
  }

  /**
   * Graceful shutdown: disconnect all active voice sessions
   */
  async onModuleDestroy() {
    this.logger.log(`Graceful shutdown: Closing ${this.activeSockets.size} active voice sessions...`);

    const disconnectPromises: Promise<void>[] = [];
    for (const [sessionId, socket] of this.activeSockets) {
      disconnectPromises.push(
        this.conversationEngine.terminateSession(sessionId).catch((err) => {
          this.logger.error(`Error terminating session ${sessionId} during shutdown`, err instanceof Error ? err.stack : undefined);
        }),
      );
      socket.disconnect(true);
    }

    await Promise.all(disconnectPromises);
    this.activeSockets.clear();
    this.logger.log('All voice sessions closed successfully.');
  }

  @SubscribeMessage('audio-in')
  handleAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { payload: string; sequence: number; timestamp: number }
  ) {
    const { callSessionId } = client.handshake.query;
    const sessionIdStr = Array.isArray(callSessionId) ? callSessionId[0] : callSessionId;

    if (!sessionIdStr) return;

    // 4. Packet validation & Ordering logs
    if (!data.payload) {
      this.logger.warn(`Null payload received in packet sequence: ${data.sequence}`);
      return;
    }

    // Measure network latency
    const networkLatency = Date.now() - data.timestamp;
    if (networkLatency > 300) {
      this.logger.warn(`High latency detected on stream packet ${data.sequence}: ${networkLatency}ms`);
    }

    const audioBuffer = Buffer.from(data.payload, 'base64');
    
    // 5. Forward audio stream chunk to active Conversation Engine session
    this.conversationEngine.streamAudio(sessionIdStr, audioBuffer);
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(@ConnectedSocket() client: Socket) {
    // Keep-alive heartbeat verification
    client.emit('heartbeat-ack', { timestamp: Date.now() });
  }

  /**
   * Authenticate a WebSocket connection token.
   * Supports: JWT tokens, configured gateway token, and bypass-auth for local dev.
   */
  private async authenticateConnection(token: string): Promise<{ valid: boolean; reason?: string; organizationId?: string }> {
    // Allow configured gateway token (for internal services / telephony providers)
    const gatewayToken = process.env.VOICE_GATEWAY_TOKEN;
    if (gatewayToken && token === gatewayToken) {
      return { valid: true };
    }

    // Allow bypass-auth ONLY in non-production environments
    if (token === 'bypass-auth') {
      if (process.env.NODE_ENV === 'production') {
        return { valid: false, reason: 'bypass-auth is not allowed in production' };
      }
      this.logger.warn('Connection using bypass-auth (development mode only)');
      return { valid: true };
    }

    // Try JWT verification
    try {
      const payload = this.jwtService.verify(token);
      return {
        valid: true,
        organizationId: payload.organizationId,
      };
    } catch {
      return { valid: false, reason: 'Invalid or expired authentication token' };
    }
  }

  /**
   * Simple sliding-window rate limiter for WebSocket connections per organization
   */
  private checkConnectionRateLimit(organizationId: string): boolean {
    const now = Date.now();
    const windowMs = 60_000; // 1 minute window

    const rate = this.connectionRates.get(organizationId);

    if (!rate || (now - rate.windowStart) > windowMs) {
      // New window
      this.connectionRates.set(organizationId, { count: 1, windowStart: now });
      return true;
    }

    if (rate.count >= this.MAX_CONNECTIONS_PER_ORG_PER_MIN) {
      return false;
    }

    rate.count++;
    return true;
  }
}

import {
  Controller,
  Get,
  Param,
  UseGuards,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DecisionEngineService } from './decision-engine.service';
import { LatencyService } from './latency.service';
import { SessionSnapshotResponseDto } from './dto/session-snapshot.dto';

/**
 * LatencyController
 *
 * Exposes the Latency-Aware Intelligence Layer's observability data via REST.
 *
 * Routes:
 *   GET /v1/debug/latency/:callSessionId  — full session latency snapshot
 *   GET /v1/debug/latency/:callSessionId/history — raw latency history only
 *
 * Access: JWT-protected. Intended for admin dashboards, debugging tools,
 * and future analytics pipelines.
 *
 * The endpoint is read-only — it has zero side effects on the live call.
 */
@ApiTags('Debug — Latency')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'debug/latency', version: '1' })
export class LatencyController {
  constructor(
    private readonly decisionEngine: DecisionEngineService,
    private readonly latencyService: LatencyService,
  ) {}

  /**
   * GET /v1/debug/latency/:callSessionId
   *
   * Returns the full latency observability snapshot for an active call session.
   * Includes the current resolved strategy, rolling average, and turn history.
   *
   * Returns 404 if the session is not currently being tracked
   * (call ended or ENABLE_LATENCY_LAYER=false).
   */
  @Get(':callSessionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get latency snapshot for an active call session',
    description:
      'Returns the current latency metrics, resolved response strategy, and turn history ' +
      'for a live call session. Only available when ENABLE_LATENCY_LAYER=true and the ' +
      'session is actively tracked.',
  })
  @ApiParam({
    name: 'callSessionId',
    description: 'UUID of the active call session',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiOkResponse({
    description: 'Latency snapshot returned successfully',
    type: SessionSnapshotResponseDto,
  })
  @ApiNotFoundResponse({
    description:
      'Session not found — either ended, not yet started, or ENABLE_LATENCY_LAYER is false',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  async getSnapshot(
    @Param('callSessionId') callSessionId: string,
  ): Promise<SessionSnapshotResponseDto> {
    const metrics = await this.latencyService.getMetrics(callSessionId);

    if (!metrics) {
      throw new NotFoundException(
        `No latency data found for session "${callSessionId}". ` +
          'The session may have ended, not yet started, or ENABLE_LATENCY_LAYER may be disabled.',
      );
    }

    // Enrich with strategy — DecisionEngineService.getSessionSnapshot is pure (no side effects)
    const snapshot = await this.decisionEngine.getSessionSnapshot(callSessionId);
    return SessionSnapshotResponseDto.fromSnapshot(snapshot);
  }

  /**
   * GET /v1/debug/latency/:callSessionId/history
   *
   * Lightweight endpoint returning only the raw latency history array.
   * Useful for charting tools or dashboards that handle aggregation themselves.
   */
  @Get(':callSessionId/history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get raw latency turn history for a session',
    description:
      'Returns only the array of recent per-turn latency values (last 10 turns). ' +
      'Lighter alternative to the full snapshot when only charting data is needed.',
  })
  @ApiParam({
    name: 'callSessionId',
    description: 'UUID of the active call session',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiOkResponse({
    description: 'Latency history returned successfully',
    schema: {
      type: 'object',
      properties: {
        callSessionId: { type: 'string' },
        history: {
          type: 'array',
          items: { type: 'number' },
          description: 'Per-turn AI response latency in ms (most recent last)',
          example: [210, 340, 280, 510, 390],
        },
        sampleCount: { type: 'number', example: 5 },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Session not found or not tracked' })
  async getHistory(
    @Param('callSessionId') callSessionId: string,
  ): Promise<{ callSessionId: string; history: number[]; sampleCount: number }> {
    const history = await this.latencyService.getLatencyHistory(callSessionId);

    if (history.length === 0) {
      // Could be no data yet or session not tracked — return 404 only if metrics null
      const metrics = await this.latencyService.getMetrics(callSessionId);
      if (!metrics) {
        throw new NotFoundException(
          `No latency data found for session "${callSessionId}".`,
        );
      }
    }

    return {
      callSessionId,
      history,
      sampleCount: history.length,
    };
  }
}

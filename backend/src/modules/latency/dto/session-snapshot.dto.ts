import { ApiProperty } from '@nestjs/swagger';
import { SessionSnapshot, LatencyStrategy } from '../latency.types';

/**
 * SessionSnapshotResponseDto
 *
 * The public HTTP response shape for latency observability endpoints.
 * Maps 1:1 from the internal SessionSnapshot type — explicit DTO keeps the
 * HTTP contract stable even if internal types evolve.
 *
 * Swagger annotations enable auto-generated API docs and client codegen.
 */
export class SessionSnapshotResponseDto {
  @ApiProperty({
    description: 'The active call session identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  callSessionId: string;

  @ApiProperty({
    description: 'Most recent AI response latency in milliseconds',
    example: 620,
  })
  currentLatency: number;

  @ApiProperty({
    description: 'Rolling average latency across the last N turns (ms)',
    example: 510,
  })
  avgLatency: number;

  @ApiProperty({
    description:
      'Current resolved response strategy based on avgLatency and spike detection. ' +
      'FULL = normal response, SHORT = one-sentence constraint, FILLER = bridging phrase injected.',
    enum: ['FULL', 'SHORT', 'FILLER'],
    example: 'SHORT',
  })
  strategy: LatencyStrategy;

  @ApiProperty({
    description: 'Per-turn AI response latency history (most recent last, max 10 turns)',
    type: [Number],
    example: [420, 480, 510, 590, 620],
  })
  history: number[];

  @ApiProperty({
    description: 'Number of turns recorded in history',
    example: 5,
  })
  sampleCount: number;

  @ApiProperty({
    description: 'Unix timestamp (ms) of the most recent latency measurement',
    example: 1721321187432,
  })
  lastUpdated: number;

  @ApiProperty({
    description: 'ISO 8601 string of lastUpdated — convenience field for display',
    example: '2026-07-18T18:26:27.432Z',
  })
  lastUpdatedIso: string;

  /**
   * Factory method — constructs the DTO from the internal SessionSnapshot type.
   * Single conversion point: change the mapping here, not in the controller.
   */
  static fromSnapshot(snapshot: SessionSnapshot): SessionSnapshotResponseDto {
    const dto = new SessionSnapshotResponseDto();
    dto.callSessionId  = snapshot.callSessionId;
    dto.currentLatency = snapshot.currentLatency;
    dto.avgLatency     = snapshot.avgLatency;
    dto.strategy       = snapshot.strategy;
    dto.history        = snapshot.history;
    dto.sampleCount    = snapshot.history.length;
    dto.lastUpdated    = snapshot.lastUpdated;
    dto.lastUpdatedIso = snapshot.lastUpdated
      ? new Date(snapshot.lastUpdated).toISOString()
      : '';
    return dto;
  }
}

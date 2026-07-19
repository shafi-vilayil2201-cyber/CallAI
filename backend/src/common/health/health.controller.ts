import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health-indicator';
import { RedisHealthIndicator } from './redis.health-indicator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
  ) {}

  /**
   * GET /health
   * Liveness probe — returns 200 if the process is running.
   * Used by K8s/ECS to determine if the container should be restarted.
   */
  @Get()
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  /**
   * GET /health/ready
   * Readiness probe — checks database and Redis connectivity.
   * Used by K8s/ECS to determine if the container can receive traffic.
   */
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.prismaHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('redis'),
    ]);
  }
}

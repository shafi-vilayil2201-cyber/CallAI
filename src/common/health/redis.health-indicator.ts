import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  private readonly redisClient: Redis;

  constructor(private readonly configService: ConfigService) {
    super();
    this.redisClient = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
  }

  /**
   * Checks Redis connectivity by sending a PING command
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.redisClient.connect();
      const result = await this.redisClient.ping();
      await this.redisClient.disconnect();

      if (result === 'PONG') {
        return this.getStatus(key, true);
      }

      throw new Error(`Unexpected Redis response: ${result}`);
    } catch (error) {
      // Ensure cleanup on failure
      try {
        await this.redisClient.disconnect();
      } catch {
        // Ignore disconnect errors during health check failure
      }

      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, { message: error instanceof Error ? error.message : 'Unknown error' }),
      );
    }
  }
}

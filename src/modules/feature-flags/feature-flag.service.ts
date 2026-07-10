import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StructuredLogger } from '../../common/logger/logger.service';

@Injectable()
export class FeatureFlagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLogger
  ) {
    this.logger.setContext('FeatureFlagService');
  }

  /**
   * Evaluates if a feature flag is enabled for a specific organization
   * @param flagName Name of the feature flag (e.g. "ENABLE_RECORDING")
   * @param organizationId UUID of the organization
   * @returns boolean
   */
  async isEnabled(flagName: string, organizationId?: string): Promise<boolean> {
    try {
      // 1. Check if flag exists globally
      const flag = await this.prisma.featureFlag.findUnique({
        where: { name: flagName },
      });

      if (!flag) {
        this.logger.warn(`Feature flag '${flagName}' not found. Defaulting to false.`);
        return false;
      }

      // If enabled globally, check if we need tenant-specific logic
      if (flag.isEnabledGlobally) {
        return true;
      }

      // 2. Organization settings overrides
      if (organizationId) {
        const orgSettings = await this.prisma.organizationSettings.findUnique({
          where: { organizationId },
        });

        // Let's model custom behavior overrides. For example, if recording is requested:
        if (flagName === 'ENABLE_RECORDING') {
          return orgSettings?.recordingEnabled ?? true;
        }

        // Custom checks can be modeled by parsing json in organization settings or configuration overrides
      }

      return false;
    } catch (error) {
      this.logger.error(`Error evaluating feature flag: ${flagName}`, error instanceof Error ? error.stack : undefined);
      return false;
    }
  }
}

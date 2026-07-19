import { Module } from '@nestjs/common';
import { CostTrackerService } from './cost-tracker.service';
import { BillingController } from './billing.controller';

@Module({
  controllers: [BillingController],
  providers: [CostTrackerService],
  exports: [CostTrackerService],
})
export class BillingModule {}

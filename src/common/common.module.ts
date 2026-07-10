import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { StructuredLogger } from './logger/logger.service';
import { EventBusService } from './event-bus/event-bus.service';
import { ObservabilityService } from './observability/observability.service';
import { HttpExceptionFilter } from './filters/http-exception.filter';

/**
 * Global module exporting all shared infrastructure services.
 * Imported once in AppModule — available everywhere without re-importing.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    StructuredLogger,
    EventBusService,
    ObservabilityService,
    HttpExceptionFilter,
  ],
  exports: [
    PrismaService,
    StructuredLogger,
    EventBusService,
    ObservabilityService,
    HttpExceptionFilter,
  ],
})
export class CommonModule {}

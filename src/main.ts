import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { StructuredLogger } from './common/logger/logger.service';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  // Use custom structured logger during boot
  const loggerInstance = new StructuredLogger();
  loggerInstance.setContext('Bootstrap');
  
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: loggerInstance,
  });

  // 1. Enable Global CORS
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // 2. Global API Versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // 3. Strict Input DTO Validations
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,            // Strips non-validated parameters
      transform: true,            // Autotransform primitives to DTO types
      forbidNonWhitelisted: true, // Throws error on unapproved params
    })
  );

  // 4. Global standard error filters
  const filterLogger = await app.resolve(StructuredLogger);
  app.useGlobalFilters(new HttpExceptionFilter(filterLogger));

  // 5. API Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('CallAI API')
    .setDescription('CallAI - Voice Intelligence Platform Infrastructure API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // 6. Serve static files from /public for the Developer Sandbox UI
  app.useStaticAssets(join(__dirname, '..', '..', 'public'));

  // 7. Enable Graceful Shutdown Hooks
  app.enableShutdownHooks();

  // 8. Register shutdown signal handlers
  const signals = ['SIGTERM', 'SIGINT'] as const;
  for (const signal of signals) {
    process.on(signal, async () => {
      loggerInstance.log(`Received ${signal}. Starting graceful shutdown...`);
      await app.close();
      loggerInstance.log('Application shutdown complete.');
      process.exit(0);
    });
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  loggerInstance.log(`CallAI core engine running on port: ${port}`);
  loggerInstance.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  loggerInstance.log(`Swagger docs: http://localhost:${port}/docs`);
  loggerInstance.log(`Health check: http://localhost:${port}/health`);
  loggerInstance.log(`Developer sandbox: http://localhost:${port}/`);
}

bootstrap();


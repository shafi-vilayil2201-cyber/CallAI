import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { StructuredLogger } from '../logger/logger.service';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLogger) {
    this.logger.setContext('HttpExceptionFilter');
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const errorDetails = exception instanceof Error ? exception.message : 'Unknown error';
    const trace = exception instanceof Error ? exception.stack : undefined;

    // Log the error using the structured logger
    this.logger.error(
      {
        path: request.url,
        method: request.method,
        status,
        message: typeof message === 'object' ? JSON.stringify(message) : message,
        details: errorDetails,
      },
      trace,
      'HttpExceptionFilter'
    );

    // Standard JSON API Error envelope
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      error: typeof message === 'object' ? (message as any).error || (message as any).message : message,
    });
  }
}

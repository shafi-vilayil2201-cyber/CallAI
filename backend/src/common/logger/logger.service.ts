import { Injectable, LoggerService, Scope } from '@nestjs/common';

@Injectable({ scope: Scope.TRANSIENT })
export class StructuredLogger implements LoggerService {
  private context: string = 'System';

  setContext(context: string) {
    this.context = context;
  }

  log(message: any, context?: string) {
    this.print('info', message, context);
  }

  error(message: any, trace?: string, context?: string) {
    this.print('error', message, context, { trace });
  }

  warn(message: any, context?: string) {
    this.print('warn', message, context);
  }

  debug(message: any, context?: string) {
    if (process.env.NODE_ENV !== 'production') {
      this.print('debug', message, context);
    }
  }

  verbose(message: any, context?: string) {
    if (process.env.NODE_ENV !== 'production') {
      this.print('verbose', message, context);
    }
  }

  private print(level: string, message: any, context?: string, extra: Record<string, any> = {}) {
    const activeContext = context || this.context;
    const logPayload = {
      timestamp: new Date().toISOString(),
      level,
      context: activeContext,
      message: typeof message === 'object' ? message : String(message),
      ...extra,
    };

    if (process.env.NODE_ENV === 'production') {
      // Output as structured single-line JSON for log aggregators (e.g. Datadog, Loki)
      console.log(JSON.stringify(logPayload));
    } else {
      // Human readable colored output for local CLI debug
      const color = this.getColor(level);
      const reset = '\x1b[0m';
      console.log(
        `[${logPayload.timestamp}] ${color}${level.toUpperCase()}${reset} [${activeContext}] ${
          typeof message === 'object' ? JSON.stringify(message, null, 2) : message
        }${extra.trace ? `\nTrace: ${extra.trace}` : ''}`
      );
    }
  }

  private getColor(level: string): string {
    switch (level) {
      case 'error': return '\x1b[31m'; // Red
      case 'warn': return '\x1b[33m';  // Yellow
      case 'info': return '\x1b[32m';  // Green
      case 'debug': return '\x1b[34m'; // Blue
      default: return '\x1b[37m';     // White
    }
  }
}

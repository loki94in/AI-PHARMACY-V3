export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogContext {
  module?: string;
  operation?: string;
  requestId?: string;
  durationMs?: number;
  [key: string]: any;
}

class AppLogger {
  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const mod = context?.module ? `[${context.module}]` : '';
    const op = context?.operation ? `[${context.operation}]` : '';
    const req = context?.requestId ? `[req:${context.requestId}]` : '';
    const dur = context?.durationMs !== undefined ? ` (${context.durationMs}ms)` : '';

    return `${timestamp} ${level.padEnd(5)} ${mod}${op}${req} ${message}${dur}`;
  }

  debug(message: string, context?: LogContext): void {
    if (process.env.DEBUG || process.env.NODE_ENV !== 'production') {
      console.debug(this.formatMessage('DEBUG', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    console.log(this.formatMessage('INFO', message, context));
  }

  warn(message: string, context?: LogContext): void {
    console.warn(this.formatMessage('WARN', message, context));
  }

  error(message: string, error?: any, context?: LogContext): void {
    const formatted = this.formatMessage('ERROR', message, context);
    if (error) {
      console.error(formatted, error);
    } else {
      console.error(formatted);
    }
  }
}

export const logger = new AppLogger();

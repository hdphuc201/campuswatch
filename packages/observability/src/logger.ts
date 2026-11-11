import { redact, redactString } from './redact.js';

export type LogLevelName = 'fatal' | 'error' | 'warn' | 'log' | 'debug' | 'verbose';

const SEVERITY: Record<LogLevelName, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  log: 3,
  debug: 4,
  verbose: 5,
};

export interface LogRecord {
  time: string;
  level: LogLevelName;
  service: string;
  context?: string;
  message: string;
  [field: string]: unknown;
}

/**
 * One JSON object per line on stdout (stderr for errors). Every message and field passes
 * through `redact`, so callers cannot accidentally log tokens, emails, scores, or markup.
 * Structurally compatible with NestJS `LoggerService`.
 */
export class JsonLogger {
  constructor(
    private readonly service: string,
    private readonly threshold: LogLevelName = 'log',
    private readonly write: (line: string, level: LogLevelName) => void = (line, level) => {
      (SEVERITY[level] <= SEVERITY.warn ? process.stderr : process.stdout).write(`${line}\n`);
    },
  ) {}

  log(message: unknown, ...rest: unknown[]): void {
    this.emit('log', message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.emit('error', message, rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.emit('warn', message, rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.emit('verbose', message, rest);
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    this.emit('fatal', message, rest);
  }

  /** Structured event with fields, e.g. `event('log', 'http_request', { status: 200 })`. */
  event(level: LogLevelName, message: string, fields: Record<string, unknown>): void {
    if (SEVERITY[level] > SEVERITY[this.threshold]) {
      return;
    }
    const record: LogRecord = {
      time: new Date().toISOString(),
      level,
      service: this.service,
      message: redactString(message),
      ...(redact(fields) as Record<string, unknown>),
    };
    this.write(JSON.stringify(record), level);
  }

  private emit(level: LogLevelName, message: unknown, rest: unknown[]): void {
    // Nest passes the context as the last string argument, and a stack for errors.
    const context = typeof rest.at(-1) === 'string' ? (rest.at(-1) as string) : undefined;
    const extra = context === undefined ? rest : rest.slice(0, -1);
    const fields: Record<string, unknown> = context ? { context } : {};
    if (message instanceof Error) {
      fields.error = message;
    }
    if (extra.length > 0) {
      fields.details = extra;
    }
    const text =
      message instanceof Error
        ? message.message
        : typeof message === 'string'
          ? message
          : JSON.stringify(redact(message));
    this.event(level, text, fields);
  }
}

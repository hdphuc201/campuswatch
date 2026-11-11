import type { LogLevel } from '@nestjs/common';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;
const LOCAL_REDIS_URL = 'redis://127.0.0.1:6379';
/** Matches the defaults in infra/docker-compose.yml. Local development only. */
const LOCAL_DATABASE_URL = 'postgresql://campuswatch:campuswatch_local@127.0.0.1:5432/campuswatch';

const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('log'),
    REDIS_URL: z
      .url({ protocol: /^rediss?$/, error: 'Must be a redis:// or rediss:// URL' })
      .optional(),
    DATABASE_URL: z
      .url({ protocol: /^postgres(ql)?$/, error: 'Must be a postgresql:// URL' })
      .optional(),
    TELEGRAM_BOT_TOKEN: z
      .string()
      .regex(/^\d{5,}:[A-Za-z0-9_-]{30,}$/, 'Must be a Telegram bot token')
      .optional(),
    ENCRYPTION_KEY: z
      .string()
      .refine((value) => Buffer.from(value, 'base64').length === 32, 'Must be 32 bytes, base64')
      .optional(),
    TELEGRAM_DISPATCH_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
    RETENTION_HISTORY_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
    RETENTION_OPERATIONAL_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
  })
  .superRefine((env, context) => {
    if (env.TELEGRAM_BOT_TOKEN !== undefined && env.ENCRYPTION_KEY === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['ENCRYPTION_KEY'],
        message: 'Required when Telegram is enabled',
      });
    }
    if (env.NODE_ENV !== 'production') {
      return;
    }
    for (const key of ['REDIS_URL', 'DATABASE_URL'] as const) {
      if (env[key] === undefined) {
        context.addIssue({ code: 'custom', path: [key], message: 'Required in production' });
      }
    }
  });

export interface RedisConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly db: number;
  readonly username?: string;
  readonly password?: string;
  readonly tls?: Record<string, never>;
}

export interface WorkerConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: LogLevel;
  readonly redis: RedisConnectionConfig;
  readonly databaseUrl: string;
  /** `null` when no bot token is configured: Telegram delivery is disabled. */
  readonly telegram: { readonly botToken: string; readonly encryptionKey: string } | null;
  readonly telegramDispatchIntervalSeconds: number;
  readonly retention: { readonly historyDays: number; readonly operationalDays: number };
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

function parseRedisUrl(value: string): RedisConnectionConfig {
  const url = new URL(value);
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  if (!Number.isInteger(db) || db < 0) {
    throw new ConfigError('Invalid worker configuration: REDIS_URL: Invalid database index');
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    db,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

/**
 * Validates worker configuration before anything connects. Empty variables count as
 * unset, and values (which may contain credentials) are never echoed in errors.
 */
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = workerEnvSchema.safeParse(present);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid worker configuration: ${details}`);
  }
  const data = result.data;
  return {
    nodeEnv: data.NODE_ENV,
    logLevel: data.LOG_LEVEL,
    redis: parseRedisUrl(data.REDIS_URL ?? LOCAL_REDIS_URL),
    databaseUrl: data.DATABASE_URL ?? LOCAL_DATABASE_URL,
    telegram:
      data.TELEGRAM_BOT_TOKEN && data.ENCRYPTION_KEY
        ? { botToken: data.TELEGRAM_BOT_TOKEN, encryptionKey: data.ENCRYPTION_KEY }
        : null,
    telegramDispatchIntervalSeconds: data.TELEGRAM_DISPATCH_INTERVAL_SECONDS,
    retention: {
      historyDays: data.RETENTION_HISTORY_DAYS,
      operationalDays: data.RETENTION_OPERATIONAL_DAYS,
    },
  };
}

/** Nest expects the full list of enabled levels, from most to least severe. */
export function enabledLogLevels(threshold: LogLevel): LogLevel[] {
  return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(threshold) + 1);
}

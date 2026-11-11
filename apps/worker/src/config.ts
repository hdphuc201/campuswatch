import type { LogLevel } from '@nestjs/common';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;
const LOCAL_REDIS_URL = 'redis://127.0.0.1:6379';

const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('log'),
    REDIS_URL: z
      .url({ protocol: /^rediss?$/, error: 'Must be a redis:// or rediss:// URL' })
      .optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.REDIS_URL !== undefined, {
    path: ['REDIS_URL'],
    error: 'Required in production',
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
  const { NODE_ENV, LOG_LEVEL, REDIS_URL } = result.data;
  return {
    nodeEnv: NODE_ENV,
    logLevel: LOG_LEVEL,
    redis: parseRedisUrl(REDIS_URL ?? LOCAL_REDIS_URL),
  };
}

/** Nest expects the full list of enabled levels, from most to least severe. */
export function enabledLogLevels(threshold: LogLevel): LogLevel[] {
  return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(threshold) + 1);
}

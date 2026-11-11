import { randomBytes } from 'node:crypto';
import type { LogLevel } from '@nestjs/common';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;

/** Matches the defaults in infra/docker-compose.yml. Local development only. */
export const LOCAL_DATABASE_URL =
  'postgresql://campuswatch:campuswatch_local@127.0.0.1:5432/campuswatch';

const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('log'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z
      .url({ protocol: /^postgres(ql)?$/, error: 'Must be a postgresql:// URL' })
      .optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    AUTH_SECRET: z.string().min(32, 'Must be at least 32 characters').optional(),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    TELEGRAM_BOT_TOKEN: z
      .string()
      .regex(/^\d{5,}:[A-Za-z0-9_-]{30,}$/, 'Must be a Telegram bot token')
      .optional(),
    TELEGRAM_BOT_USERNAME: z
      .string()
      .regex(/^[A-Za-z0-9_]{5,32}$/, 'Must be a Telegram bot username without @')
      .optional(),
    TELEGRAM_WEBHOOK_SECRET: z
      .string()
      .regex(/^[A-Za-z0-9_-]{32,256}$/, 'Must be 32-256 characters of A-Z, a-z, 0-9, _ or -')
      .optional(),
    ENCRYPTION_KEY: z
      .string()
      .refine((value) => Buffer.from(value, 'base64').length === 32, 'Must be 32 bytes, base64')
      .optional(),
    /** Shared rate-limit counters. Without it, limits are per process (development only). */
    REDIS_URL: z
      .url({ protocol: /^rediss?$/, error: 'Must be a redis:// or rediss:// URL' })
      .optional(),
    RATE_LIMITS_ENABLED: z.enum(['true', 'false']).default('true'),
    /** Number of trusted reverse proxies in front of the API (for client IPs). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** Bearer token for GET /ops/metrics. Unset disables the endpoint. */
    OPS_METRICS_TOKEN: z
      .string()
      .regex(/^[A-Za-z0-9_-]{32,256}$/, 'Must be 32-256 characters of A-Z, a-z, 0-9, _ or -')
      .optional(),
  })
  .superRefine((env, context) => {
    const telegramKeys = [
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_BOT_USERNAME',
      'TELEGRAM_WEBHOOK_SECRET',
      'ENCRYPTION_KEY',
    ] as const;
    if (telegramKeys.some((key) => key !== 'ENCRYPTION_KEY' && env[key] !== undefined)) {
      for (const key of telegramKeys) {
        if (env[key] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: 'Required when Telegram is enabled',
          });
        }
      }
    }
    if (env.NODE_ENV !== 'production') {
      return;
    }
    for (const key of ['DATABASE_URL', 'AUTH_SECRET', 'REDIS_URL'] as const) {
      if (env[key] === undefined) {
        context.addIssue({ code: 'custom', path: [key], message: 'Required in production' });
      }
    }
    if (env.RATE_LIMITS_ENABLED === 'false') {
      context.addIssue({
        code: 'custom',
        path: ['RATE_LIMITS_ENABLED'],
        message: 'Rate limits cannot be disabled in production',
      });
    }
  });

export interface ApiConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: LogLevel;
  readonly host: string;
  readonly port: number;
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
  };
  readonly auth: {
    readonly secret: string;
    /** True when no AUTH_SECRET was set and a random one was generated for this process. */
    readonly secretIsEphemeral: boolean;
    readonly accessTokenTtlSeconds: number;
    readonly refreshTokenTtlDays: number;
  };
  readonly redisUrl: string | null;
  readonly rateLimitsEnabled: boolean;
  readonly trustProxyHops: number;
  /** `null` disables the metrics endpoint. */
  readonly opsMetricsToken: string | null;
  /** `null` when no Telegram bot is configured: Telegram delivery is disabled. */
  readonly telegram: {
    readonly botToken: string;
    readonly botUsername: string;
    readonly webhookSecret: string;
    readonly encryptionKey: string;
  } | null;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Validates API configuration. Empty variables count as unset; values are never echoed. */
export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = apiEnvSchema.safeParse(present);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid API configuration: ${details}`);
  }
  const data = result.data;
  return {
    nodeEnv: data.NODE_ENV,
    logLevel: data.LOG_LEVEL,
    host: data.API_HOST,
    port: data.API_PORT,
    database: {
      url: data.DATABASE_URL ?? LOCAL_DATABASE_URL,
      poolMax: data.DATABASE_POOL_MAX,
    },
    auth: {
      // Outside production a missing secret is replaced by a random one: tokens then
      // stop working when the process restarts, which is acceptable for local development.
      secret: data.AUTH_SECRET ?? randomBytes(32).toString('base64url'),
      secretIsEphemeral: data.AUTH_SECRET === undefined,
      accessTokenTtlSeconds: data.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlDays: data.REFRESH_TOKEN_TTL_DAYS,
    },
    redisUrl: data.REDIS_URL ?? null,
    rateLimitsEnabled: data.RATE_LIMITS_ENABLED === 'true',
    trustProxyHops: data.TRUST_PROXY_HOPS,
    opsMetricsToken: data.OPS_METRICS_TOKEN ?? null,
    telegram:
      data.TELEGRAM_BOT_TOKEN &&
      data.TELEGRAM_BOT_USERNAME &&
      data.TELEGRAM_WEBHOOK_SECRET &&
      data.ENCRYPTION_KEY
        ? {
            botToken: data.TELEGRAM_BOT_TOKEN,
            botUsername: data.TELEGRAM_BOT_USERNAME,
            webhookSecret: data.TELEGRAM_WEBHOOK_SECRET,
            encryptionKey: data.ENCRYPTION_KEY,
          }
        : null,
  };
}

/** Nest expects the full list of enabled levels, from most to least severe. */
export function enabledLogLevels(threshold: LogLevel): LogLevel[] {
  return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(threshold) + 1);
}

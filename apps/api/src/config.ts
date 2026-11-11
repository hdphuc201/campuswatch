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
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV !== 'production') {
      return;
    }
    for (const key of ['DATABASE_URL', 'AUTH_SECRET'] as const) {
      if (env[key] === undefined) {
        context.addIssue({ code: 'custom', path: [key], message: 'Required in production' });
      }
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
  };
}

/** Nest expects the full list of enabled levels, from most to least severe. */
export function enabledLogLevels(threshold: LogLevel): LogLevel[] {
  return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(threshold) + 1);
}

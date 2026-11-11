import type { LogLevel } from '@nestjs/common';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;

const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('log'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export interface ApiConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: LogLevel;
  readonly host: string;
  readonly port: number;
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
  const { NODE_ENV, LOG_LEVEL, API_HOST, API_PORT } = result.data;
  return { nodeEnv: NODE_ENV, logLevel: LOG_LEVEL, host: API_HOST, port: API_PORT };
}

/** Nest expects the full list of enabled levels, from most to least severe. */
export function enabledLogLevels(threshold: LogLevel): LogLevel[] {
  return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(threshold) + 1);
}

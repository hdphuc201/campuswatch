import { createHash } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  type OnApplicationShutdown,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Redis } from 'ioredis';
import type { RequestWithPrincipal } from '../auth/principal.js';
import type { ApiConfig } from '../config.js';
import { API_CONFIG } from '../config.module.js';

/** Counts hits per key in fixed windows. */
export interface RateLimitStore {
  /** Increments the counter and returns the new count and the window's remaining time. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  hit(key: string, windowMs: number) {
    const now = Date.now();
    const current = this.windows.get(key);
    const window =
      current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
    window.count += 1;
    this.windows.set(key, window);
    if (this.windows.size > 10_000) {
      for (const [stale, value] of this.windows) {
        if (value.resetAt <= now) {
          this.windows.delete(stale);
        }
      }
    }
    return Promise.resolve({ count: window.count, resetMs: window.resetAt - now });
  }
}

export class RedisRateLimitStore implements RateLimitStore, OnApplicationShutdown {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, windowMs: number) {
    const redisKey = `ratelimit:${key}`;
    const results = await this.redis
      .multi()
      .incr(redisKey)
      .pexpire(redisKey, windowMs, 'NX')
      .pttl(redisKey)
      .exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    const ttl = Number(results?.[2]?.[1] ?? -1);
    return { count, resetMs: ttl > 0 ? ttl : windowMs };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}

type KeySource = 'ip' | 'user' | 'device' | 'email';

interface Rule {
  readonly limit: number;
  readonly windowMs: number;
  readonly by: KeySource;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Per-route limits (implementation plan, section 11). Several rules can apply to one route;
 * any exceeded rule rejects the request with 429.
 */
export const RATE_LIMITS = {
  login: [
    { limit: 20, windowMs: 15 * MINUTE, by: 'ip' },
    { limit: 8, windowMs: 15 * MINUTE, by: 'email' },
  ],
  register: [{ limit: 10, windowMs: HOUR, by: 'ip' }],
  refresh: [{ limit: 60, windowMs: 15 * MINUTE, by: 'ip' }],
  probe: [{ limit: 60, windowMs: HOUR, by: 'device' }],
  snapshot: [{ limit: 30, windowMs: HOUR, by: 'device' }],
  pendingNotifications: [{ limit: 120, windowMs: HOUR, by: 'device' }],
  telegramStart: [{ limit: 10, windowMs: HOUR, by: 'user' }],
  telegramWebhook: [{ limit: 300, windowMs: MINUTE, by: 'ip' }],
  privacy: [{ limit: 5, windowMs: HOUR, by: 'user' }],
} as const satisfies Record<string, readonly Rule[]>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export const RATE_LIMIT_KEY = 'campuswatch:rate-limit';
export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

export const RateLimit = (name: RateLimitName) => SetMetadata(RATE_LIMIT_KEY, name);

interface LimitedRequest extends RequestWithPrincipal {
  readonly ip?: string;
  readonly body?: unknown;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

function keyFor(source: KeySource, request: LimitedRequest): string | null {
  switch (source) {
    case 'ip':
      return request.ip ? `ip:${hash(request.ip)}` : null;
    case 'user':
      return request.principal ? `user:${request.principal.userId}` : null;
    case 'device':
      return request.principal?.kind === 'device' ? `device:${request.principal.deviceId}` : null;
    case 'email': {
      const email = (request.body as { email?: unknown } | undefined)?.email;
      // Hashed so that no email address is stored in the rate-limit store.
      return typeof email === 'string' ? `email:${hash(email.trim().toLowerCase())}` : null;
    }
  }
}

/** Global guard; runs after authentication so user and device limits can use the principal. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const name = this.reflector.getAllAndOverride<RateLimitName | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!name || !this.config.rateLimitsEnabled) {
      return true;
    }
    const http = context.switchToHttp();
    const request = http.getRequest<LimitedRequest>();
    for (const rule of RATE_LIMITS[name] as readonly Rule[]) {
      const key = keyFor(rule.by, request);
      if (!key) {
        continue;
      }
      const { count, resetMs } = await this.store.hit(`${name}:${key}`, rule.windowMs);
      if (count > rule.limit) {
        http
          .getResponse<{ header(name: string, value: string): void }>()
          .header('retry-after', String(Math.ceil(resetMs / 1000)));
        throw new HttpException(
          {
            statusCode: 429,
            code: 'rate_limited',
            message: 'Too many requests. Please try again later.',
          },
          429,
        );
      }
    }
    return true;
  }
}

export function createRateLimitStore(config: ApiConfig): RateLimitStore {
  return config.redisUrl
    ? new RedisRateLimitStore(new Redis(config.redisUrl, { maxRetriesPerRequest: 2 }))
    : new MemoryRateLimitStore();
}

import type { AuthTokensResponse } from '@campuswatch/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { loadApiConfig } from '../../src/config.js';
import { configureHttp, createHttpAdapter } from '../../src/http.js';
import { JsonLogger } from '@campuswatch/observability';
import { TELEGRAM_CLIENT } from '../../src/notifications/telegram.service.js';
import { FakeTelegramClient } from '@campuswatch/notifications/server';
import { createTestDatabase, type TestDatabase } from '@campuswatch/db/testing';

export interface TestApp {
  readonly app: NestFastifyApplication;
  /** URL of this test file's throwaway database, for direct assertions. */
  readonly databaseUrl: string;
  /** Messages "sent" to Telegram (only when created with `telegram: true`). */
  readonly telegram: FakeTelegramClient;
  /** Every JSON log line the app wrote (already redacted). */
  readonly logs: string[];
  /** Every registered route (method and URL template). */
  readonly routes: { method: string; url: string }[];
  close(): Promise<void>;
}

/** Boots the real application module against a fresh database. */
export const TEST_TELEGRAM = {
  TELEGRAM_BOT_TOKEN: '123456789:test_token_not_real_test_token_not_real',
  TELEGRAM_BOT_USERNAME: 'CampusWatchTestBot',
  TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret-test-webhook-secret',
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

export const TEST_OPS_TOKEN = 'ops-metrics-token-for-tests-ops-metrics-token';

export async function createTestApp(
  options: { telegram?: boolean; rateLimits?: boolean } = {},
): Promise<TestApp> {
  const database: TestDatabase = await createTestDatabase();
  const telegram = new FakeTelegramClient();
  const config = loadApiConfig({
    NODE_ENV: 'test',
    DATABASE_URL: database.url,
    DATABASE_POOL_MAX: '5',
    AUTH_SECRET: 'integration-test-secret-integration-test',
    ...(options.telegram ? TEST_TELEGRAM : {}),
    // Most suites make many requests from one IP; the rate-limit suite turns them on.
    RATE_LIMITS_ENABLED: options.rateLimits ? 'true' : 'false',
    OPS_METRICS_TOKEN: TEST_OPS_TOKEN,
    LOG_LEVEL: 'verbose',
  });
  const logs: string[] = [];
  const logger = new JsonLogger('campuswatch-api', 'verbose', (line) => logs.push(line));
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(TELEGRAM_CLIENT)
    .useValue(options.telegram ? telegram : null)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createHttpAdapter(), {
    logger,
  });
  configureHttp(app, { logger, production: false });
  const routes: { method: string; url: string }[] = [];
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) {
        if (method !== 'HEAD') {
          routes.push({ method, url: route.url });
        }
      }
    });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    databaseUrl: database.url,
    telegram,
    logs,
    routes,
    close: async () => {
      await app.close();
      await database.drop();
    },
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export async function registerUser(
  app: NestFastifyApplication,
  email: string,
  password = 'a long enough test password',
): Promise<AuthTokensResponse> {
  const registered = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password },
  });
  if (registered.statusCode !== 202) {
    throw new Error(`Registration failed with ${registered.statusCode}: ${registered.body}`);
  }
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  if (login.statusCode !== 200) {
    throw new Error(`Login failed with ${login.statusCode}`);
  }
  return login.json<AuthTokensResponse>();
}

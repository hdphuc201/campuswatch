import type { AuthTokensResponse } from '@campuswatch/contracts';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { loadApiConfig } from '../../src/config.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

export interface TestApp {
  readonly app: NestFastifyApplication;
  close(): Promise<void>;
}

/** Boots the real application module against a fresh database. */
export async function createTestApp(): Promise<TestApp> {
  const database: TestDatabase = await createTestDatabase();
  const config = loadApiConfig({
    NODE_ENV: 'test',
    DATABASE_URL: database.url,
    DATABASE_POOL_MAX: '5',
    AUTH_SECRET: 'integration-test-secret-integration-test',
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
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
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password },
  });
  if (response.statusCode !== 201) {
    throw new Error(`Registration failed with ${response.statusCode}: ${response.body}`);
  }
  return response.json<AuthTokensResponse>();
}

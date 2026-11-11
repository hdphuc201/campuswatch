import { randomUUID } from 'node:crypto';
import type { PortalConnection, RegisterDeviceResponse } from '@campuswatch/contracts';
import { fingerprintEntity } from '@campuswatch/portal-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  registerUser,
  TEST_OPS_TOKEN,
  TEST_TELEGRAM,
  type TestApp,
} from './support/test-app.js';

describe('rate limits (integration)', () => {
  let testApp: TestApp;
  const app = () => testApp.app;

  beforeAll(async () => {
    testApp = await createTestApp({ rateLimits: true });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('limits login attempts per email and answers 429 with Retry-After', async () => {
    await registerUser(app(), 'limited@example.edu', 'the right password!');
    const attempt = () =>
      app().inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'limited@example.edu', password: 'wrong password' },
      });
    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      statuses.push((await attempt()).statusCode);
    }
    // The registration helper already used one login for this email.
    expect(statuses.filter((status) => status === 401).length).toBe(7);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ code: 'rate_limited' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // Even the correct password waits: the limit is not a password oracle.
    const correct = await app().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'limited@example.edu', password: 'the right password!' },
    });
    expect(correct.statusCode).toBe(429);
  });

  it('limits snapshot uploads per device', async () => {
    const { accessToken } = await registerUser(app(), 'uploads@example.edu');
    const device = (
      await app().inject({
        method: 'POST',
        url: '/devices/register',
        headers: bearer(accessToken),
        payload: { name: 'Chrome', extensionVersion: '0.1.0' },
      })
    ).json<RegisterDeviceResponse>();
    const connection = (
      await app().inject({
        method: 'POST',
        url: '/portal-connections',
        headers: bearer(accessToken),
        payload: { adapterKey: 'citd', consentVersion: '2026-11' },
      })
    ).json<PortalConnection>();
    const upload = () =>
      app().inject({
        method: 'POST',
        url: '/sync-runs',
        headers: bearer(device.deviceToken),
        payload: {
          connectionId: connection.id,
          syncRunId: randomUUID(),
          collectedAt: new Date().toISOString(),
          sources: [{ source: 'exams', status: 'ok', entities: [] }],
        },
      });
    for (let i = 0; i < 30; i += 1) {
      expect((await upload()).statusCode).toBe(200);
    }
    expect((await upload()).statusCode).toBe(429);
  });
});

describe('error format, headers, logging, and metrics (integration)', () => {
  let testApp: TestApp;
  const app = () => testApp.app;

  beforeAll(async () => {
    testApp = await createTestApp({ telegram: true });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('uses one error shape with a code and request id for every failure', async () => {
    const notFound = await app().inject({ method: 'GET', url: '/nope' });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toMatchObject({ statusCode: 404, code: 'not_found' });
    expect(notFound.json<{ requestId: string }>().requestId).toBe(notFound.headers['x-request-id']);

    const malformed = await app().inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"email": ',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ code: 'bad_request' });

    const tooLarge = await app().inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'x'.repeat(3 * 1024 * 1024) }),
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json()).toMatchObject({ code: 'payload_too_large' });

    const unauthorized = await app().inject({ method: 'GET', url: '/auth/me' });
    expect(unauthorized.json()).toMatchObject({ statusCode: 401, code: 'unauthorized' });
  });

  it('sends security headers on every response', async () => {
    const response = await app().inject({ method: 'GET', url: '/health' });
    expect(response.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
    });
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('logs requests without tokens, emails, passwords, scores, amounts, or chat ids', async () => {
    const email = 'logged.student@example.edu';
    const password = 'secret password value 42';
    const tokens = await registerUser(app(), email, password);
    const device = (
      await app().inject({
        method: 'POST',
        url: '/devices/register',
        headers: bearer(tokens.accessToken),
        payload: { name: 'Chrome', extensionVersion: '0.1.0' },
      })
    ).json<RegisterDeviceResponse>();
    const connection = (
      await app().inject({
        method: 'POST',
        url: '/portal-connections',
        headers: bearer(tokens.accessToken),
        payload: { adapterKey: 'citd', consentVersion: '2026-11' },
      })
    ).json<PortalConnection>();
    const payload = { courseCode: 'CS101', totalScore: 9.25, amountDue: 9_800_000 };
    const entity = {
      entityType: 'grade_course' as const,
      externalKey: 'k',
      payload,
      fingerprint: await fingerprintEntity({
        entityType: 'grade_course',
        externalKey: 'k',
        payload,
      }),
    };
    await app().inject({
      method: 'POST',
      url: '/sync-runs',
      headers: bearer(device.deviceToken),
      payload: {
        connectionId: connection.id,
        syncRunId: randomUUID(),
        collectedAt: new Date().toISOString(),
        sources: [{ source: 'grades', status: 'ok', entities: [entity] }],
      },
    });
    await app().inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    });
    await app().inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': TEST_TELEGRAM.TELEGRAM_WEBHOOK_SECRET },
      payload: {
        update_id: 1,
        message: { text: 'hello', chat: { id: 987654321, type: 'private' } },
      },
    });

    const logs = testApp.logs.join('\n');
    expect(testApp.logs.some((line) => line.includes('"message":"http_request"'))).toBe(true);
    for (const secret of [
      email,
      password,
      tokens.accessToken,
      tokens.refreshToken,
      device.deviceToken,
      '9.25',
      '9800000',
      '987654321',
      TEST_TELEGRAM.TELEGRAM_WEBHOOK_SECRET,
      TEST_TELEGRAM.TELEGRAM_BOT_TOKEN,
    ]) {
      expect(logs, `logs contain ${secret.slice(0, 12)}…`).not.toContain(secret);
    }
  });

  it('serves aggregate metrics only with the operations token', async () => {
    expect((await app().inject({ method: 'GET', url: '/ops/metrics' })).statusCode).toBe(401);
    expect(
      (await app().inject({ method: 'GET', url: '/ops/metrics', headers: bearer('wrong-token') }))
        .statusCode,
    ).toBe(401);

    const metrics = await app().inject({
      method: 'GET',
      url: '/ops/metrics',
      headers: bearer(TEST_OPS_TOKEN),
    });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.body).toContain('campuswatch_sync_runs_24h{status="completed"}');
    expect(metrics.body).toContain('campuswatch_connections{status=');
    expect(metrics.body).not.toMatch(/@|CS101|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

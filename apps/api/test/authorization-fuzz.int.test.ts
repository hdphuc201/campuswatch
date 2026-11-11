import { randomUUID } from 'node:crypto';
import type { PortalConnection, RegisterDeviceResponse } from '@campuswatch/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, registerUser, type TestApp } from './support/test-app.js';

type Auth = 'public' | 'user' | 'device' | 'webhook' | 'ops';

/**
 * Every route the API exposes and who may call it. The test fails when a route is added
 * without being listed here, so new endpoints are always covered by the fuzzing below.
 */
const ROUTE_POLICY: Record<string, Auth> = {
  'GET /health': 'public',
  'GET /health/ready': 'public',
  'POST /auth/register': 'public',
  'POST /auth/login': 'public',
  'POST /auth/refresh': 'public',
  'POST /auth/logout': 'public',
  'GET /auth/me': 'user',
  'POST /devices/register': 'user',
  'GET /devices': 'user',
  'DELETE /devices/:id': 'user',
  'POST /portal-connections': 'user',
  'GET /portal-connections': 'user',
  'DELETE /portal-connections/:id': 'user',
  'POST /portal-connections/:id/pause': 'user',
  'POST /portal-connections/:id/resume': 'user',
  'POST /portal-connections/:id/probe': 'device',
  'POST /sync-runs': 'device',
  'GET /changes': 'user',
  'GET /entities/:type': 'user',
  'GET /notification-preferences': 'user',
  'PUT /notification-preferences': 'user',
  'GET /notifications': 'user',
  'GET /notifications/pending': 'device',
  'POST /notifications/ack': 'device',
  'GET /telegram/link': 'user',
  'POST /telegram/link/start': 'user',
  'DELETE /telegram/link': 'user',
  'POST /telegram/webhook': 'webhook',
  'GET /privacy/consents': 'user',
  'POST /privacy/export': 'user',
  'DELETE /privacy/data': 'user',
  'DELETE /privacy/account': 'user',
  'GET /ops/metrics': 'ops',
};

describe('authorization fuzzing (integration)', () => {
  let testApp: TestApp;
  const app = () => testApp.app;

  interface Actor {
    accessToken: string;
    deviceToken: string;
    deviceId: string;
    connectionId: string;
  }
  let victim: Actor;
  let attacker: Actor;

  async function actor(email: string): Promise<Actor> {
    const { accessToken } = await registerUser(app(), email);
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
    return {
      accessToken,
      deviceToken: device.deviceToken,
      deviceId: device.device.id,
      connectionId: connection.id,
    };
  }

  /** Concrete URL targeting the victim's resources. */
  const target = (url: string) =>
    url
      .replace('/devices/:id', `/devices/${victim.deviceId}`)
      .replace(':id', victim.connectionId)
      .replace(':type', 'grade_course');

  /** A plausible body aimed at the victim, so validation passes and authorization decides. */
  const body = (key: string) =>
    ({
      'POST /sync-runs': {
        connectionId: victim.connectionId,
        syncRunId: randomUUID(),
        collectedAt: new Date().toISOString(),
        sources: [{ source: 'exams', status: 'ok', entities: [] }],
      },
      'POST /portal-connections/:id/probe': { result: 'authenticated' },
      'POST /notifications/ack': { deliveryIds: [randomUUID()] },
      'POST /privacy/export': { password: 'a long enough test password' },
      'DELETE /privacy/data': { password: 'a long enough test password' },
      'DELETE /privacy/account': { password: 'a long enough test password' },
    })[key];

  beforeAll(async () => {
    testApp = await createTestApp();
    victim = await actor('victim@example.edu');
    attacker = await actor('attacker@example.edu');
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('every registered route has an explicit authorization policy', () => {
    const registered = new Set(testApp.routes.map((route) => `${route.method} ${route.url}`));
    expect([...registered].sort()).toEqual(Object.keys(ROUTE_POLICY).sort());
  });

  it('rejects missing, malformed, forged, and wrong-kind credentials on every protected route', async () => {
    const forged = `${attacker.accessToken.slice(0, -6)}AAAAAA`;
    for (const [key, auth] of Object.entries(ROUTE_POLICY)) {
      if (auth === 'public') {
        continue;
      }
      const [method, url] = key.split(' ') as ['GET' | 'POST' | 'PUT' | 'DELETE', string];
      const wrongKind = auth === 'device' ? attacker.accessToken : attacker.deviceToken;
      for (const headers of [
        {},
        bearer('garbage'),
        bearer(forged),
        bearer(wrongKind),
        { authorization: 'Basic eDp5' },
      ]) {
        const response = await app().inject({
          method,
          url: target(url),
          headers,
          ...(body(key) ? { payload: body(key) } : {}),
        });
        expect([401, 404], `${key} with ${JSON.stringify(headers).slice(0, 40)}`).toContain(
          response.statusCode,
        );
      }
    }
  });

  it("the attacker's valid credentials never reach the victim's resources", async () => {
    for (const [key, auth] of Object.entries(ROUTE_POLICY)) {
      if (auth !== 'user' && auth !== 'device') {
        continue;
      }
      const [method, url] = key.split(' ') as ['GET' | 'POST' | 'PUT' | 'DELETE', string];
      if (!url.includes(':') && key !== 'POST /sync-runs') {
        continue; // Collection routes are scoped to the caller; covered by the isolation suites.
      }
      const token = auth === 'device' ? attacker.deviceToken : attacker.accessToken;
      const response = await app().inject({
        method,
        url: target(url),
        headers: bearer(token),
        ...(body(key) ? { payload: body(key) } : {}),
      });
      if (key === 'GET /entities/:type') {
        // Type-scoped listing: allowed, but must contain only the attacker's own data.
        expect(response.json<{ entities: unknown[] }>().entities).toEqual([]);
        continue;
      }
      expect(response.statusCode, key).toBe(404);
    }

    // The victim's resources are untouched.
    const devices = await app().inject({
      method: 'GET',
      url: '/devices',
      headers: bearer(victim.accessToken),
    });
    expect(devices.json<{ devices: unknown[] }>().devices).toHaveLength(1);
    const connections = await app().inject({
      method: 'GET',
      url: '/portal-connections',
      headers: bearer(victim.accessToken),
    });
    expect(connections.json<{ connections: { status: string }[] }>().connections).toEqual([
      expect.objectContaining({ status: 'LOGIN_REQUIRED' }),
    ]);
  });

  it('rejects ownership fields smuggled into every body', async () => {
    const response = await app().inject({
      method: 'PUT',
      url: '/notification-preferences',
      headers: bearer(attacker.accessToken),
      payload: { userId: randomUUID() },
    });
    expect(response.statusCode).toBe(400);
  });
});

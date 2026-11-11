import { type PortalConnection, type RegisterDeviceResponse } from '@campuswatch/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, registerUser, type TestApp } from './support/test-app.js';

describe('portal connection pause and resume (integration)', () => {
  let testApp: TestApp;
  const app = () => testApp.app;
  let ownerToken: string;
  let otherToken: string;
  let deviceToken: string;
  let connectionId: string;

  const probe = (result: string, token = deviceToken) =>
    app().inject({
      method: 'POST',
      url: `/portal-connections/${connectionId}/probe`,
      headers: bearer(token),
      payload: { result },
    });
  const action = (name: 'pause' | 'resume', token = ownerToken) =>
    app().inject({
      method: 'POST',
      url: `/portal-connections/${connectionId}/${name}`,
      headers: bearer(token),
    });

  beforeAll(async () => {
    testApp = await createTestApp();
    ownerToken = (await registerUser(app(), 'pause-owner@example.edu')).accessToken;
    otherToken = (await registerUser(app(), 'pause-other@example.edu')).accessToken;
    const device = await app().inject({
      method: 'POST',
      url: '/devices/register',
      headers: bearer(ownerToken),
      payload: { name: 'Chrome', extensionVersion: '0.1.0' },
    });
    deviceToken = device.json<RegisterDeviceResponse>().deviceToken;
    const connection = await app().inject({
      method: 'POST',
      url: '/portal-connections',
      headers: bearer(ownerToken),
      payload: { adapterKey: 'citd', consentVersion: '2026-11' },
    });
    connectionId = connection.json<PortalConnection>().id;
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('a probe can never overwrite a paused connection', async () => {
    expect((await probe('authenticated')).json<PortalConnection>().status).toBe('CONNECTED');

    const paused = await action('pause');
    expect(paused.statusCode).toBe(200);
    expect(paused.json<PortalConnection>().status).toBe('PAUSED');

    for (const result of ['authenticated', 'login_required', 'unavailable']) {
      const response = await probe(result);
      expect(response.statusCode).toBe(200);
      expect(response.json<PortalConnection>().status).toBe('PAUSED');
    }
  });

  it('resume waits for the next probe before reporting CONNECTED', async () => {
    const resumed = await action('resume');
    expect(resumed.json<PortalConnection>().status).toBe('LOGIN_REQUIRED');

    expect((await probe('authenticated')).json<PortalConnection>().status).toBe('CONNECTED');
  });

  it('resume of a connection that is not paused leaves it unchanged', async () => {
    const response = await action('resume');

    expect(response.statusCode).toBe(200);
    expect(response.json<PortalConnection>().status).toBe('CONNECTED');
  });

  it('another user cannot pause or resume the connection', async () => {
    expect((await action('pause', otherToken)).statusCode).toBe(404);
    expect((await action('resume', otherToken)).statusCode).toBe(404);
  });

  it('pause and resume require a user token, not a device token', async () => {
    expect((await action('pause', deviceToken)).statusCode).toBe(401);
  });
});

import {
  type AuthTokensResponse,
  authTokensResponseSchema,
  readinessResponseSchema,
  userProfileSchema,
} from '@campuswatch/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, registerUser, type TestApp } from './support/test-app.js';

describe('identity (integration)', () => {
  let testApp: TestApp;
  const app = () => testApp.app;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('reports the database as ready', async () => {
    const response = await app().inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(readinessResponseSchema.parse(response.json()).status).toBe('ok');
  });

  it('registers a user, normalizes the email, and never returns secrets', async () => {
    const response = await app().inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: '  New.Student@Example.EDU ', password: 'a long enough password' },
    });

    expect(response.statusCode).toBe(201);
    const tokens = authTokensResponseSchema.parse(response.json());
    const me = await app().inject({
      method: 'GET',
      url: '/auth/me',
      headers: bearer(tokens.accessToken),
    });
    expect(userProfileSchema.parse(me.json()).email).toBe('new.student@example.edu');
    expect(me.body).not.toMatch(/password|hash/i);
  });

  it('rejects a duplicate email regardless of case', async () => {
    await registerUser(app(), 'dup@example.edu');

    const response = await app().inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'DUP@example.edu', password: 'another long password' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('rejects invalid bodies, including client-supplied ownership fields', async () => {
    const response = await app().inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'owner@example.edu',
        password: 'a long enough password',
        userId: '00000000-0000-4000-8000-000000000000',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: 'Validation failed' });
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    await registerUser(app(), 'login@example.edu', 'the right password!');

    const wrongPassword = await app().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'login@example.edu', password: 'the wrong password' },
    });
    const unknownEmail = await app().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@example.edu', password: 'the wrong password' },
    });
    const correct = await app().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'LOGIN@example.edu', password: 'the right password!' },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
    expect(correct.statusCode).toBe(200);
  });

  it('protects routes by default and rejects malformed or forged tokens', async () => {
    const tokens = await registerUser(app(), 'guard@example.edu');
    const forged = `${tokens.accessToken.slice(0, -4)}AAAA`;

    for (const headers of [{}, bearer('garbage'), bearer(forged), { authorization: 'Basic x' }]) {
      const response = await app().inject({ method: 'GET', url: '/auth/me', headers });
      expect(response.statusCode).toBe(401);
    }
  });

  it('does not accept a device token where a user token is required', async () => {
    const tokens = await registerUser(app(), 'device-as-user@example.edu');
    const device = await app().inject({
      method: 'POST',
      url: '/devices/register',
      headers: bearer(tokens.accessToken),
      payload: { name: 'Chrome', extensionVersion: '0.1.0' },
    });
    const { deviceToken } = device.json<{ deviceToken: string }>();

    const response = await app().inject({
      method: 'GET',
      url: '/auth/me',
      headers: bearer(deviceToken),
    });

    expect(response.statusCode).toBe(401);
  });

  describe('refresh tokens', () => {
    const refresh = (refreshToken: string) =>
      app().inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });

    it('rotates: each refresh token works exactly once', async () => {
      const first = await registerUser(app(), 'rotate@example.edu');

      const second = await refresh(first.refreshToken);
      expect(second.statusCode).toBe(200);
      const rotated = authTokensResponseSchema.parse(second.json());
      expect(rotated.refreshToken).not.toBe(first.refreshToken);

      const meWithNewToken = await app().inject({
        method: 'GET',
        url: '/auth/me',
        headers: bearer(rotated.accessToken),
      });
      expect(meWithNewToken.statusCode).toBe(200);
    });

    it('revokes the whole session family when a used refresh token is replayed', async () => {
      const first = await registerUser(app(), 'replay@example.edu');
      const rotated = (await refresh(first.refreshToken)).json<AuthTokensResponse>();

      const replay = await refresh(first.refreshToken);
      expect(replay.statusCode).toBe(401);

      // The legitimate holder's newer tokens are now revoked too.
      expect((await refresh(rotated.refreshToken)).statusCode).toBe(401);
      const me = await app().inject({
        method: 'GET',
        url: '/auth/me',
        headers: bearer(rotated.accessToken),
      });
      expect(me.statusCode).toBe(401);
    });

    it('logout ends the session immediately, including its access token', async () => {
      const tokens = await registerUser(app(), 'logout@example.edu');

      const logout = await app().inject({
        method: 'POST',
        url: '/auth/logout',
        payload: { refreshToken: tokens.refreshToken },
      });

      expect(logout.statusCode).toBe(204);
      expect((await refresh(tokens.refreshToken)).statusCode).toBe(401);
      const me = await app().inject({
        method: 'GET',
        url: '/auth/me',
        headers: bearer(tokens.accessToken),
      });
      expect(me.statusCode).toBe(401);
    });

    it('logout of one session leaves the user’s other sessions working', async () => {
      const laptop = await registerUser(app(), 'two-sessions@example.edu');
      const phone = (
        await app().inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'two-sessions@example.edu', password: 'a long enough test password' },
        })
      ).json<AuthTokensResponse>();

      await app().inject({
        method: 'POST',
        url: '/auth/logout',
        payload: { refreshToken: laptop.refreshToken },
      });

      const me = await app().inject({
        method: 'GET',
        url: '/auth/me',
        headers: bearer(phone.accessToken),
      });
      expect(me.statusCode).toBe(200);
    });
  });
});

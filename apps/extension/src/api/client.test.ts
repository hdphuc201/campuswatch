import { describe, expect, it } from 'vitest';
import { createHarness } from '../test/harness.js';
import { ApiError, NetworkError, SessionExpiredError } from './client.js';

async function signedIn() {
  const harness = createHarness();
  await harness.controller.handle({
    type: 'register',
    email: 'client@example.edu',
    password: 'a long enough password',
  });
  return harness;
}

describe('CampusWatchApi', () => {
  it('refreshes an expired access token once and retries the request', async () => {
    const { api, backend, state } = await signedIn();
    const before = await state.getSession();
    backend.expireAccessTokens();

    await expect(api.listConnections()).resolves.toEqual([]);

    const after = await state.getSession();
    expect(after?.refreshToken).not.toBe(before?.refreshToken);
    expect(backend.calls.filter((call) => call === 'POST /auth/refresh')).toHaveLength(1);
  });

  it('refreshes only once when concurrent requests all get 401', async () => {
    const { api, backend } = await signedIn();
    backend.expireAccessTokens();

    await Promise.all([api.listConnections(), api.listConnections(), api.listConnections()]);

    expect(backend.calls.filter((call) => call === 'POST /auth/refresh')).toHaveLength(1);
  });

  it('reports an ended session when the refresh token is no longer valid', async () => {
    const { api, backend, state } = await signedIn();
    const session = await state.getSession();
    await state.setSession({ ...session!, refreshToken: 'cwr_revoked' });
    backend.expireAccessTokens();

    await expect(api.listConnections()).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('distinguishes network failures from API errors', async () => {
    const { api, backend } = await signedIn();

    backend.setOffline(true);
    await expect(api.listConnections()).rejects.toBeInstanceOf(NetworkError);

    backend.setOffline(false);
    backend.failNextRequest(503);
    const error = await api.listConnections().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).transient).toBe(true);
  });

  it('sends the device token, not the user token, on device routes', async () => {
    const { api, backend, state, controller } = await signedIn();
    await controller.handle({ type: 'connect' });
    const connection = await state.getConnection();
    backend.expireAccessTokens();

    // A device route never triggers a user-token refresh.
    await expect(
      api.reportProbe(connection!.id, { result: 'authenticated' }),
    ).resolves.toMatchObject({ status: 'CONNECTED' });
    expect(backend.calls).not.toContain('POST /auth/refresh');
  });
});

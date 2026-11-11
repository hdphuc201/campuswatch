import {
  deviceListResponseSchema,
  portalConnectionListResponseSchema,
  type PortalConnection,
  portalConnectionSchema,
  type RegisterDeviceResponse,
} from '@campuswatch/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, registerUser, type TestApp } from './support/test-app.js';

/**
 * Acceptance test for P2 (implementation plan, sections 3 and 9): User B can never read,
 * change, or act on User A's devices or Portal connections, with user or device tokens.
 */
describe('multi-user isolation (integration)', () => {
  let testApp: TestApp;
  const app = () => testApp.app;

  interface Actor {
    accessToken: string;
    device: RegisterDeviceResponse;
    connection: PortalConnection;
  }
  let userA: Actor;
  let userB: Actor;

  async function createActor(email: string): Promise<Actor> {
    const { accessToken } = await registerUser(app(), email);
    const device = await app().inject({
      method: 'POST',
      url: '/devices/register',
      headers: bearer(accessToken),
      payload: { name: `Chrome of ${email}`, extensionVersion: '0.1.0' },
    });
    expect(device.statusCode).toBe(201);
    const connection = await app().inject({
      method: 'POST',
      url: '/portal-connections',
      headers: bearer(accessToken),
      payload: { adapterKey: 'citd', consentVersion: '2026-11' },
    });
    expect(connection.statusCode).toBe(201);
    return {
      accessToken,
      device: device.json<RegisterDeviceResponse>(),
      connection: portalConnectionSchema.parse(connection.json()),
    };
  }

  beforeAll(async () => {
    testApp = await createTestApp();
    userA = await createActor('a@example.edu');
    userB = await createActor('b@example.edu');
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('lists only the caller’s own devices', async () => {
    const response = await app().inject({
      method: 'GET',
      url: '/devices',
      headers: bearer(userB.accessToken),
    });

    const ids = deviceListResponseSchema.parse(response.json()).devices.map((d) => d.id);
    expect(ids).toEqual([userB.device.device.id]);
  });

  it('lists only the caller’s own Portal connections', async () => {
    const response = await app().inject({
      method: 'GET',
      url: '/portal-connections',
      headers: bearer(userB.accessToken),
    });

    const ids = portalConnectionListResponseSchema
      .parse(response.json())
      .connections.map((c) => c.id);
    expect(ids).toEqual([userB.connection.id]);
  });

  it('User B cannot revoke User A’s device (404, not 403: no existence leak)', async () => {
    const response = await app().inject({
      method: 'DELETE',
      url: `/devices/${userA.device.device.id}`,
      headers: bearer(userB.accessToken),
    });

    expect(response.statusCode).toBe(404);
    const stillThere = await app().inject({
      method: 'GET',
      url: '/devices',
      headers: bearer(userA.accessToken),
    });
    expect(deviceListResponseSchema.parse(stillThere.json()).devices).toHaveLength(1);
  });

  it('User B cannot delete User A’s Portal connection', async () => {
    const response = await app().inject({
      method: 'DELETE',
      url: `/portal-connections/${userA.connection.id}`,
      headers: bearer(userB.accessToken),
    });

    expect(response.statusCode).toBe(404);
    const stillThere = await app().inject({
      method: 'GET',
      url: '/portal-connections',
      headers: bearer(userA.accessToken),
    });
    expect(portalConnectionListResponseSchema.parse(stillThere.json()).connections).toHaveLength(1);
  });

  it('User B’s device cannot report a probe for User A’s connection', async () => {
    const response = await app().inject({
      method: 'POST',
      url: `/portal-connections/${userA.connection.id}/probe`,
      headers: bearer(userB.device.deviceToken),
      payload: { result: 'authenticated' },
    });

    expect(response.statusCode).toBe(404);
    const unchanged = await app().inject({
      method: 'GET',
      url: '/portal-connections',
      headers: bearer(userA.accessToken),
    });
    const [connection] = portalConnectionListResponseSchema.parse(unchanged.json()).connections;
    expect(connection).toMatchObject({ status: 'LOGIN_REQUIRED', lastProbedAt: null });
  });

  it('a device reports probes for its own owner’s connection', async () => {
    const response = await app().inject({
      method: 'POST',
      url: `/portal-connections/${userA.connection.id}/probe`,
      headers: bearer(userA.device.deviceToken),
      payload: { result: 'authenticated' },
    });

    expect(response.statusCode).toBe(200);
    expect(portalConnectionSchema.parse(response.json())).toMatchObject({
      id: userA.connection.id,
      status: 'CONNECTED',
    });
  });

  it('probe requires a device token, not a user access token', async () => {
    const response = await app().inject({
      method: 'POST',
      url: `/portal-connections/${userA.connection.id}/probe`,
      headers: bearer(userA.accessToken),
      payload: { result: 'authenticated' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('ignores ownership hints in the request: the owner comes from the token only', async () => {
    const response = await app().inject({
      method: 'POST',
      url: '/portal-connections',
      headers: bearer(userB.accessToken),
      payload: { adapterKey: 'citd', consentVersion: '2026-11', userId: 'a@example.edu' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('allows one connection per adapter per user, independently for each user', async () => {
    const duplicate = await app().inject({
      method: 'POST',
      url: '/portal-connections',
      headers: bearer(userA.accessToken),
      payload: { adapterKey: 'citd', consentVersion: '2026-11' },
    });

    expect(duplicate.statusCode).toBe(409);
  });

  it('a revoked device token stops working immediately, only for that device', async () => {
    const extra = await createActor('c@example.edu');
    const revoke = await app().inject({
      method: 'DELETE',
      url: `/devices/${extra.device.device.id}`,
      headers: bearer(extra.accessToken),
    });
    expect(revoke.statusCode).toBe(204);

    const revokedProbe = await app().inject({
      method: 'POST',
      url: `/portal-connections/${extra.connection.id}/probe`,
      headers: bearer(extra.device.deviceToken),
      payload: { result: 'authenticated' },
    });
    expect(revokedProbe.statusCode).toBe(401);

    const otherDeviceProbe = await app().inject({
      method: 'POST',
      url: `/portal-connections/${userB.connection.id}/probe`,
      headers: bearer(userB.device.deviceToken),
      payload: { result: 'login_required' },
    });
    expect(otherDeviceProbe.statusCode).toBe(200);
  });

  it('rejects non-UUID ids before touching the database', async () => {
    const response = await app().inject({
      method: 'DELETE',
      url: "/devices/1' OR '1'='1",
      headers: bearer(userA.accessToken),
    });

    expect(response.statusCode).toBe(400);
  });

  it('deleting a connection is scoped to the owner and frees the adapter slot', async () => {
    const remove = await app().inject({
      method: 'DELETE',
      url: `/portal-connections/${userB.connection.id}`,
      headers: bearer(userB.accessToken),
    });
    expect(remove.statusCode).toBe(204);

    const recreate = await app().inject({
      method: 'POST',
      url: '/portal-connections',
      headers: bearer(userB.accessToken),
      payload: { adapterKey: 'citd', consentVersion: '2026-12' },
    });
    expect(recreate.statusCode).toBe(201);

    const userAConnections = await app().inject({
      method: 'GET',
      url: '/portal-connections',
      headers: bearer(userA.accessToken),
    });
    expect(
      portalConnectionListResponseSchema.parse(userAConnections.json()).connections,
    ).toHaveLength(1);
  });
});

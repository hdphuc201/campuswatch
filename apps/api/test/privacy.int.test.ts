import { randomUUID } from 'node:crypto';
import {
  consentListResponseSchema,
  dataExportSchema,
  type PortalConnection,
  type RegisterDeviceResponse,
} from '@campuswatch/contracts';
import { fingerprintEntity } from '@campuswatch/portal-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, registerUser, type TestApp } from './support/test-app.js';

const PASSWORD = 'a long enough test password';

/** Every table that holds user-owned rows, with its owner column. */
const USER_TABLES = [
  ['users', 'id'],
  ['auth_sessions', 'user_id'],
  ['devices', 'user_id'],
  ['portal_connections', 'user_id'],
  ['consent_audits', 'user_id'],
  ['sync_runs', 'user_id'],
  ['entities', 'user_id'],
  ['change_events', 'user_id'],
  ['notification_preferences', 'user_id'],
  ['notification_deliveries', 'user_id'],
  ['telegram_links', 'user_id'],
  ['telegram_link_nonces', 'user_id'],
] as const;

describe('privacy: export, consent, and deletion (integration)', () => {
  let testApp: TestApp;
  const app = () => testApp.app;

  interface Actor {
    userId: string;
    accessToken: string;
    deviceToken: string;
    connectionId: string;
  }

  async function actorWithData(email: string): Promise<Actor> {
    const { accessToken } = await registerUser(app(), email, PASSWORD);
    const me = await app().inject({ method: 'GET', url: '/auth/me', headers: bearer(accessToken) });
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
    for (const total of [null, 8]) {
      const payload = { courseCode: 'CS101', totalScore: total };
      await app().inject({
        method: 'POST',
        url: '/sync-runs',
        headers: bearer(device.deviceToken),
        payload: {
          connectionId: connection.id,
          syncRunId: randomUUID(),
          collectedAt: new Date().toISOString(),
          sources: [
            {
              source: 'grades',
              status: 'ok',
              entities: [
                {
                  entityType: 'grade_course',
                  externalKey: 'CS101',
                  payload,
                  fingerprint: await fingerprintEntity({
                    entityType: 'grade_course',
                    externalKey: 'CS101',
                    payload,
                  }),
                },
              ],
            },
          ],
        },
      });
    }
    return {
      userId: me.json<{ id: string }>().id,
      accessToken,
      deviceToken: device.deviceToken,
      connectionId: connection.id,
    };
  }

  async function rowCounts(userId: string): Promise<Record<string, number>> {
    const client = new pg.Client({ connectionString: testApp.databaseUrl });
    await client.connect();
    try {
      const counts: Record<string, number> = {};
      for (const [table, column] of USER_TABLES) {
        const { rows } = await client.query<{ n: number }>(
          `select count(*)::int as n from ${table} where ${column} = $1`,
          [userId],
        );
        counts[table] = rows[0]?.n ?? -1;
      }
      return counts;
    } finally {
      await client.end();
    }
  }

  const privacy = (who: Actor, method: 'POST' | 'DELETE', path: string, password = PASSWORD) =>
    app().inject({
      method,
      url: `/privacy/${path}`,
      headers: bearer(who.accessToken),
      payload: { password },
    });

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('exports all of the user’s data without secrets, after re-authentication', async () => {
    const alice = await actorWithData('export-alice@example.edu');
    const bob = await actorWithData('export-bob@example.edu');

    const wrong = await privacy(alice, 'POST', 'export', 'not the password');
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toMatchObject({ code: 'reauthentication_failed' });

    const response = await privacy(alice, 'POST', 'export');
    expect(response.statusCode).toBe(200);
    const exported = dataExportSchema.parse(response.json());
    expect(exported.profile.email).toBe('export-alice@example.edu');
    expect(exported.connections.map((c) => c.id)).toEqual([alice.connectionId]);
    expect(exported.entities).toHaveLength(1);
    expect(exported.changes).toHaveLength(1);
    expect(exported.devices).toHaveLength(1);
    expect(response.body).not.toMatch(/argon2|password_?hash|token_?hash|cwd_|cwr_|chat_?id/i);
    expect(response.body).not.toContain(bob.connectionId);
    expect(response.body).not.toContain('export-bob@example.edu');
  });

  it('lists consent grants and records withdrawal on disconnect', async () => {
    const carol = await actorWithData('consent-carol@example.edu');
    await app().inject({
      method: 'DELETE',
      url: `/portal-connections/${carol.connectionId}`,
      headers: bearer(carol.accessToken),
    });
    const consents = consentListResponseSchema.parse(
      (
        await app().inject({
          method: 'GET',
          url: '/privacy/consents',
          headers: bearer(carol.accessToken),
        })
      ).json(),
    ).consents;
    expect(consents).toHaveLength(1);
    expect(consents[0]?.policyVersion).toBe('2026-11');
    expect(consents[0]?.revokedAt).not.toBeNull();
  });

  it('deletes all Portal data but keeps the account, and only for that user', async () => {
    const dave = await actorWithData('delete-data-dave@example.edu');
    const erin = await actorWithData('delete-data-erin@example.edu');
    const erinBefore = await rowCounts(erin.userId);

    expect((await privacy(dave, 'DELETE', 'data', 'wrong')).statusCode).toBe(403);
    const response = await privacy(dave, 'DELETE', 'data');
    expect(response.json()).toEqual({ status: 'deleted', scope: 'data' });

    const after = await rowCounts(dave.userId);
    expect(after).toMatchObject({
      users: 1,
      portal_connections: 0,
      sync_runs: 0,
      entities: 0,
      change_events: 0,
      notification_deliveries: 0,
      notification_preferences: 0,
      telegram_links: 0,
    });
    const me = await app().inject({
      method: 'GET',
      url: '/auth/me',
      headers: bearer(dave.accessToken),
    });
    expect(me.statusCode).toBe(200);
    expect(await rowCounts(erin.userId)).toEqual(erinBefore);
  });

  it('deletes the account and every row that belongs to it, and only that account', async () => {
    const frank = await actorWithData('delete-account-frank@example.edu');
    const grace = await actorWithData('delete-account-grace@example.edu');
    const graceBefore = await rowCounts(grace.userId);
    expect(Object.values(await rowCounts(frank.userId)).some((n) => n > 0)).toBe(true);

    const response = await privacy(frank, 'DELETE', 'account');
    expect(response.json()).toEqual({ status: 'deleted', scope: 'account' });

    const after = await rowCounts(frank.userId);
    expect(
      Object.values(after).every((n) => n === 0),
      JSON.stringify(after),
    ).toBe(true);
    expect(
      (await app().inject({ method: 'GET', url: '/auth/me', headers: bearer(frank.accessToken) }))
        .statusCode,
    ).toBe(401);
    const probe = await app().inject({
      method: 'POST',
      url: `/portal-connections/${frank.connectionId}/probe`,
      headers: bearer(frank.deviceToken),
      payload: { result: 'authenticated' },
    });
    expect(probe.statusCode).toBe(401);
    expect(await rowCounts(grace.userId)).toEqual(graceBefore);
  });
});

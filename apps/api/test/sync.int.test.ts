import { randomUUID } from 'node:crypto';
import {
  type CanonicalPayload,
  changeListResponseSchema,
  entityListResponseSchema,
  type EntityType,
  type NormalizedEntity,
  type PortalConnection,
  type RegisterDeviceResponse,
  type SnapshotRequest,
  type SyncRunResult,
} from '@campuswatch/contracts';
import { fingerprintEntity } from '@campuswatch/portal-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, registerUser, type TestApp } from './support/test-app.js';

async function entity(
  entityType: EntityType,
  externalKey: string,
  payload: CanonicalPayload,
): Promise<NormalizedEntity> {
  return {
    entityType,
    externalKey,
    payload,
    fingerprint: await fingerprintEntity({ entityType, externalKey, payload }),
  };
}

const grade = (code: string, total: number | null) =>
  entity('grade_course', `2025-2026|1|${code}|`, { courseCode: code, totalScore: total });

describe('snapshot ingest and history (integration)', () => {
  let testApp: TestApp;
  const app = () => testApp.app;

  interface Actor {
    accessToken: string;
    deviceToken: string;
    connectionId: string;
  }
  let alice: Actor;
  let bob: Actor;

  async function actor(email: string): Promise<Actor> {
    const { accessToken } = await registerUser(app(), email);
    const device = await app().inject({
      method: 'POST',
      url: '/devices/register',
      headers: bearer(accessToken),
      payload: { name: 'Chrome', extensionVersion: '0.1.0' },
    });
    const connection = await app().inject({
      method: 'POST',
      url: '/portal-connections',
      headers: bearer(accessToken),
      payload: { adapterKey: 'citd', consentVersion: '2026-11' },
    });
    return {
      accessToken,
      deviceToken: device.json<RegisterDeviceResponse>().deviceToken,
      connectionId: connection.json<PortalConnection>().id,
    };
  }

  const snapshot = (
    who: Actor,
    sources: SnapshotRequest['sources'],
    syncRunId: string = randomUUID(),
  ): SnapshotRequest => ({
    connectionId: who.connectionId,
    syncRunId,
    collectedAt: new Date().toISOString(),
    sources,
  });

  const upload = (who: Actor, body: unknown, token = who.deviceToken) =>
    app().inject({
      method: 'POST',
      url: '/sync-runs',
      headers: bearer(token),
      payload: body as object,
    });

  const changes = async (who: Actor, query = '') =>
    changeListResponseSchema.parse(
      (
        await app().inject({
          method: 'GET',
          url: `/changes${query}`,
          headers: bearer(who.accessToken),
        })
      ).json(),
    );

  beforeAll(async () => {
    testApp = await createTestApp();
    alice = await actor('alice@example.edu');
    bob = await actor('bob@example.edu');
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('stores the first snapshot of each source as a baseline without change events', async () => {
    const response = await upload(
      alice,
      snapshot(alice, [
        {
          source: 'grades',
          status: 'ok',
          entities: [await grade('CS101', null), await grade('MA101', 8)],
        },
        { source: 'exams', status: 'ok', entities: [] },
      ]),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json<SyncRunResult>()).toMatchObject({
      status: 'completed',
      entityCount: 2,
      changeCount: 0,
      replayed: false,
      connection: { status: 'CONNECTED' },
    });
    expect((await changes(alice)).changes).toEqual([]);
  });

  it('records ADDED, UPDATED, and REMOVED with field-level diffs afterwards', async () => {
    const response = await upload(
      alice,
      snapshot(alice, [
        {
          source: 'grades',
          status: 'ok',
          entities: [await grade('CS101', 8.4), await grade('EN101', null)],
        },
        {
          source: 'exams',
          status: 'ok',
          entities: [await entity('exam', '2025-2026|1|CS101|2026-01-10|Ca 1', { room: 'A1' })],
        },
      ]),
    );
    expect(response.json<SyncRunResult>().changeCount).toBe(4);

    const list = await changes(alice);
    const summary = list.changes
      .map((change) => `${change.kind} ${change.entityType} ${change.externalKey}`)
      .sort();
    expect(summary).toEqual([
      'ADDED exam 2025-2026|1|CS101|2026-01-10|Ca 1',
      'ADDED grade_course 2025-2026|1|EN101|',
      'REMOVED grade_course 2025-2026|1|MA101|',
      'UPDATED grade_course 2025-2026|1|CS101|',
    ]);
    const updated = list.changes.find((change) => change.kind === 'UPDATED');
    expect(updated?.changedFields).toEqual([{ field: 'totalScore', before: null, after: 8.4 }]);
    expect(updated?.payload).toEqual({ courseCode: 'CS101', totalScore: 8.4 });

    // An exam schedule appearing for the first time is a change, not a baseline.
    expect(list.changes.some((change) => change.entityType === 'exam')).toBe(true);
  });

  it('a retried snapshot (same syncRunId) is replayed and creates no new events', async () => {
    const body = snapshot(alice, [
      {
        source: 'grades',
        status: 'ok',
        entities: [await grade('CS101', 9), await grade('EN101', null)],
      },
    ]);
    const first = await upload(alice, body);
    const retry = await upload(alice, body);

    expect(first.json<SyncRunResult>()).toMatchObject({ replayed: false, changeCount: 1 });
    expect(retry.json<SyncRunResult>()).toMatchObject({ replayed: true, changeCount: 1 });
    const cs101 = (await changes(alice)).changes.filter((c) => c.externalKey.includes('CS101|'));
    expect(cs101.filter((c) => c.kind === 'UPDATED')).toHaveLength(2); // 7.9→8.4 earlier, 8.4→9 now
  });

  it('concurrent uploads of the same change produce exactly one change event', async () => {
    const before = (await changes(alice)).changes.length;
    const entities = [await grade('CS101', 10), await grade('EN101', null)];
    const uploads = await Promise.all(
      [randomUUID(), randomUUID(), randomUUID()].map((id) =>
        upload(alice, snapshot(alice, [{ source: 'grades', status: 'ok', entities }], id)),
      ),
    );

    expect(uploads.every((response) => response.statusCode === 200)).toBe(true);
    expect(uploads.map((r) => r.json<SyncRunResult>().changeCount).sort()).toEqual([0, 0, 1]);
    expect((await changes(alice)).changes.length).toBe(before + 1);
  });

  it('keeps data from failed sources and reports partial runs', async () => {
    const response = await upload(
      alice,
      snapshot(alice, [
        {
          source: 'grades',
          status: 'ok',
          entities: [await grade('CS101', 10), await grade('EN101', null)],
        },
        {
          source: 'exams',
          status: 'error',
          errorCode: 'ADAPTER_NEEDS_UPDATE',
          errorDetail: 'exams: table columns changed',
        },
      ]),
    );

    expect(response.json<SyncRunResult>()).toMatchObject({
      status: 'partial',
      changeCount: 0,
      connection: { status: 'ADAPTER_NEEDS_UPDATE' },
    });
    const exams = entityListResponseSchema.parse(
      (
        await app().inject({
          method: 'GET',
          url: '/entities/exam',
          headers: bearer(alice.accessToken),
        })
      ).json(),
    );
    expect(exams.entities).toHaveLength(1);
  });

  it('reports LOGIN_REQUIRED from a failed source', async () => {
    const response = await upload(
      alice,
      snapshot(alice, [
        {
          source: 'grades',
          status: 'error',
          errorCode: 'LOGIN_REQUIRED',
          errorDetail: 'login page: /',
        },
      ]),
    );
    expect(response.json<SyncRunResult>()).toMatchObject({
      status: 'failed',
      connection: { status: 'LOGIN_REQUIRED' },
    });
  });

  it('never records a removed Dashboard notice', async () => {
    const notice = await entity('portal_notice', 'a'.repeat(32), { title: 'Holiday', body: 'Off' });
    await upload(
      alice,
      snapshot(alice, [{ source: 'dashboardNotices', status: 'ok', entities: [notice] }]),
    );
    const second = await entity('portal_notice', 'b'.repeat(32), { title: 'Exams', body: 'Soon' });
    await upload(
      alice,
      snapshot(alice, [{ source: 'dashboardNotices', status: 'ok', entities: [second] }]),
    );
    await upload(
      alice,
      snapshot(alice, [{ source: 'dashboardNotices', status: 'ok', entities: [] }]),
    );

    const notices = (await changes(alice, '?entityType=portal_notice')).changes;
    expect(notices.map((change) => change.kind)).toEqual(['ADDED']);
  });

  it('rejects uploads to a paused connection', async () => {
    await app().inject({
      method: 'POST',
      url: `/portal-connections/${bob.connectionId}/pause`,
      headers: bearer(bob.accessToken),
    });
    const response = await upload(
      bob,
      snapshot(bob, [{ source: 'exams', status: 'ok', entities: [] }]),
    );

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'connection_paused' });
    await app().inject({
      method: 'POST',
      url: `/portal-connections/${bob.connectionId}/resume`,
      headers: bearer(bob.accessToken),
    });
  });

  describe('validation', () => {
    it('rejects markup, mismatched entity types, duplicates, and client ownership fields', async () => {
      const html = await entity('grade_course', 'x', {
        note: '<table><tr><td>8</td></tr></table>',
      });
      const wrongType = await entity('exam', 'x', { room: 'A1' });
      const dup = await grade('CS101', 1);
      const bodies = [
        snapshot(alice, [{ source: 'grades', status: 'ok', entities: [html] }]),
        snapshot(alice, [{ source: 'grades', status: 'ok', entities: [wrongType] }]),
        snapshot(alice, [{ source: 'grades', status: 'ok', entities: [dup, dup] }]),
        {
          ...snapshot(alice, [{ source: 'exams', status: 'ok', entities: [] }]),
          userId: randomUUID(),
        },
        snapshot(alice, [
          {
            source: 'grades',
            status: 'error',
            errorCode: 'NETWORK_ERROR',
            errorDetail: '<b>8,5</b>',
          },
        ]),
      ];
      for (const body of bodies) {
        expect((await upload(alice, body)).statusCode).toBe(400);
      }
    });

    it('rejects oversized bodies', async () => {
      const big = await entity('grade_course', 'big', { text: 'x'.repeat(3900) });
      const entities = await Promise.all(
        Array.from({ length: 700 }, (_, i) => entity('grade_course', `k${i}`, big.payload)),
      );
      const response = await upload(
        alice,
        snapshot(alice, [{ source: 'grades', status: 'ok', entities }]),
      );
      expect(response.statusCode).toBe(413);
    });

    it('requires a device token for uploads and a user token for history', async () => {
      const body = snapshot(alice, [{ source: 'exams', status: 'ok', entities: [] }]);
      expect((await upload(alice, body, alice.accessToken)).statusCode).toBe(401);
      const history = await app().inject({
        method: 'GET',
        url: '/changes',
        headers: bearer(alice.deviceToken),
      });
      expect(history.statusCode).toBe(401);
    });
  });

  describe('User A/User B isolation', () => {
    it("Bob's device cannot upload to Alice's connection", async () => {
      const response = await upload(
        bob,
        snapshot(alice, [{ source: 'grades', status: 'ok', entities: [] }]),
        bob.deviceToken,
      );
      expect(response.statusCode).toBe(404);
    });

    it("Bob cannot read Alice's changes or entities", async () => {
      expect((await changes(bob)).changes).toEqual([]);
      const filtered = await app().inject({
        method: 'GET',
        url: `/changes?connectionId=${alice.connectionId}`,
        headers: bearer(bob.accessToken),
      });
      expect(filtered.statusCode).toBe(404);
      const grades = await app().inject({
        method: 'GET',
        url: '/entities/grade_course',
        headers: bearer(bob.accessToken),
      });
      expect(entityListResponseSchema.parse(grades.json()).entities).toEqual([]);
      const scoped = await app().inject({
        method: 'GET',
        url: `/entities/grade_course?connectionId=${alice.connectionId}`,
        headers: bearer(bob.accessToken),
      });
      expect(scoped.statusCode).toBe(404);
    });

    it("Bob replaying Alice's syncRunId cannot read her stored result", async () => {
      const body = snapshot(alice, [{ source: 'exams', status: 'ok', entities: [] }]);
      await upload(alice, body);
      const response = await upload(bob, { ...body, connectionId: bob.connectionId });
      expect(response.json<SyncRunResult>()).toMatchObject({ replayed: false });
      expect(response.json<SyncRunResult>().connection.id).toBe(bob.connectionId);
    });
  });

  it('pages through history with a cursor', async () => {
    const first = await changes(alice, '?limit=2');
    expect(first.changes).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await changes(alice, `?limit=2&before=${first.nextCursor}`);
    const ids = new Set([...first.changes, ...second.changes].map((change) => change.id));
    expect(ids.size).toBe(first.changes.length + second.changes.length);
  });

  it('persists only canonical values: no markup, cookies, tokens, or headers', async () => {
    const client = new pg.Client({ connectionString: testApp.databaseUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ dump: string }>(
        `select coalesce(string_agg(payload::text, ' '), '') ||
                coalesce((select string_agg(changed_fields::text || payload::text, ' ') from change_events), '') ||
                coalesce((select string_agg(source_results::text, ' ') from sync_runs), '') as dump
           from entities`,
      );
      const dump = rows[0]?.dump ?? '';
      expect(dump.length).toBeGreaterThan(0);
      expect(dump).not.toMatch(/<table|<td|cookie|csrf|authorization|cwd_|cwr_|bearer/i);
    } finally {
      await client.end();
    }
  });
});

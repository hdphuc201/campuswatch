import { randomUUID } from 'node:crypto';
import {
  authSessions,
  changeEvents,
  devices,
  entities,
  notificationDeliveries,
  portalConnections,
  syncRuns,
  telegramLinkNonces,
  users,
} from '@campuswatch/db';
import { createTestDatabase, type TestDatabase } from '@campuswatch/db/testing';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetentionService } from '../src/system/retention.js';

const DAY = 24 * 60 * 60 * 1000;

describe('RetentionService (integration)', () => {
  let database: TestDatabase;
  let pool: pg.Pool;
  let db: NodePgDatabase;
  const now = new Date('2027-06-01T00:00:00.000Z');
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  beforeAll(async () => {
    database = await createTestDatabase();
    pool = new pg.Pool({ connectionString: database.url, max: 2 });
    db = drizzle(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it('removes only expired data and keeps current state and recent history', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.edu`, passwordHash: 'x' })
      .returning();
    const userId = user!.id;
    const [connection] = await db
      .insert(portalConnections)
      .values({ userId, adapterKey: 'citd', status: 'CONNECTED', consentVersion: '2026-11' })
      .returning();
    const run = async (receivedAt: Date) =>
      (
        await db
          .insert(syncRuns)
          .values({
            connectionId: connection!.id,
            userId,
            clientRunId: randomUUID(),
            status: 'completed',
            sourceResults: [],
            entityCount: 0,
            changeCount: 0,
            collectedAt: receivedAt,
            receivedAt,
          })
          .returning()
      )[0]!;
    const event = async (syncRunId: string, createdAt: Date) =>
      (
        await db
          .insert(changeEvents)
          .values({
            connectionId: connection!.id,
            userId,
            syncRunId,
            entityType: 'exam',
            externalKey: randomUUID(),
            kind: 'ADDED',
            changedFields: [],
            payload: {},
            fingerprint: 'f'.repeat(64),
            idempotencyKey: randomUUID(),
            createdAt,
          })
          .returning()
      )[0]!;

    const oldRunWithoutHistory = await run(ago(200));
    const oldRunWithRecentHistory = await run(ago(200));
    const oldRunWithOldHistory = await run(ago(400));
    await event(oldRunWithRecentHistory.id, ago(100));
    const expiredEvent = await event(oldRunWithOldHistory.id, ago(400));
    await db.insert(notificationDeliveries).values([
      // Deleted with its expired change event.
      {
        userId,
        changeEventId: expiredEvent.id,
        channel: 'chrome',
        category: 'exams',
        urgent: false,
        deliverAfter: ago(400),
        status: 'sent',
        createdAt: ago(400),
      },
    ]);
    const recentEvent = await event((await run(ago(1))).id, ago(1));
    await db.insert(notificationDeliveries).values([
      {
        userId,
        changeEventId: recentEvent.id,
        channel: 'chrome',
        category: 'exams',
        urgent: false,
        deliverAfter: ago(1),
        status: 'sent',
        createdAt: ago(1),
      },
      {
        userId,
        changeEventId: recentEvent.id,
        channel: 'telegram',
        category: 'exams',
        urgent: false,
        deliverAfter: ago(120),
        status: 'failed',
        createdAt: ago(120),
      },
    ]);
    await db.insert(entities).values({
      connectionId: connection!.id,
      userId,
      entityType: 'exam',
      externalKey: 'current',
      payload: {},
      fingerprint: 'f'.repeat(64),
      updatedAt: ago(800),
    });
    await db.insert(authSessions).values([
      { userId, familyId: randomUUID(), tokenHash: randomUUID(), expiresAt: ago(40) },
      { userId, familyId: randomUUID(), tokenHash: randomUUID(), expiresAt: ago(-20) },
    ]);
    await db.insert(telegramLinkNonces).values([
      { userId, nonceHash: randomUUID(), expiresAt: ago(2) },
      { userId, nonceHash: randomUUID(), expiresAt: ago(-0.001) },
    ]);
    await db.insert(devices).values([
      {
        userId,
        name: 'old',
        extensionVersion: '0.1.0',
        tokenHash: randomUUID(),
        revokedAt: ago(100),
      },
      { userId, name: 'active', extensionVersion: '0.1.0', tokenHash: randomUUID() },
    ]);

    const report = await new RetentionService(
      db,
      { historyDays: 365, operationalDays: 90 },
      () => now,
    ).run();

    expect(report).toEqual({
      changeEvents: 1,
      deliveries: 1,
      // The run without history and the run whose only event just expired.
      syncRuns: 2,
      authSessions: 1,
      linkNonces: 1,
      revokedDevices: 1,
    });
    const remainingRuns = (await db.select({ id: syncRuns.id }).from(syncRuns)).map((r) => r.id);
    expect(remainingRuns).toContain(oldRunWithRecentHistory.id);
    expect(remainingRuns).not.toContain(oldRunWithoutHistory.id);
    expect(await db.select().from(entities)).toHaveLength(1);
    expect(await db.select().from(changeEvents)).toHaveLength(2);
  });
});

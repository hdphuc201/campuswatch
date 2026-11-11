import { randomBytes, randomUUID } from 'node:crypto';
import {
  changeEvents,
  notificationDeliveries,
  notificationPreferences,
  portalConnections,
  syncRuns,
  telegramLinks,
  users,
} from '@campuswatch/db';
import { createTestDatabase, type TestDatabase } from '@campuswatch/db/testing';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@campuswatch/contracts';
import {
  createChatIdCipher,
  FakeTelegramClient,
  TelegramApiError,
} from '@campuswatch/notifications/server';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TelegramDispatcher } from '../src/notifications/telegram-dispatcher.js';

describe('TelegramDispatcher (integration)', () => {
  let database: TestDatabase;
  let pool: pg.Pool;
  let db: NodePgDatabase;
  const cipher = createChatIdCipher(randomBytes(32).toString('base64'));
  let clock = new Date('2026-11-11T08:00:00.000Z');
  const now = () => clock;

  async function userWithChanges(options: { linked: boolean; changes: number; chatId?: string }) {
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.edu`, passwordHash: 'x' })
      .returning();
    const [connection] = await db
      .insert(portalConnections)
      .values({
        userId: user!.id,
        adapterKey: 'citd',
        status: 'CONNECTED',
        consentVersion: '2026-11',
      })
      .returning();
    const [run] = await db
      .insert(syncRuns)
      .values({
        connectionId: connection!.id,
        userId: user!.id,
        clientRunId: randomUUID(),
        status: 'completed',
        sourceResults: [],
        entityCount: 0,
        changeCount: options.changes,
        collectedAt: clock,
      })
      .returning();
    for (let i = 0; i < options.changes; i += 1) {
      const [event] = await db
        .insert(changeEvents)
        .values({
          connectionId: connection!.id,
          userId: user!.id,
          syncRunId: run!.id,
          entityType: 'grade_course',
          externalKey: `2025-2026|1|CS10${i}|`,
          kind: 'UPDATED',
          changedFields: [{ field: 'totalScore', before: 7, after: 8.5 }],
          payload: { courseCode: `CS10${i}`, totalScore: 8.5 },
          fingerprint: 'f'.repeat(64),
          idempotencyKey: randomUUID(),
        })
        .returning();
      await db.insert(notificationDeliveries).values({
        userId: user!.id,
        changeEventId: event!.id,
        channel: 'telegram',
        category: 'grades',
        urgent: true,
        deliverAfter: clock,
      });
    }
    if (options.linked) {
      const chatId = options.chatId ?? String(100_000 + Math.floor(Math.random() * 1000));
      await db.insert(telegramLinks).values({
        userId: user!.id,
        chatIdEncrypted: cipher.encrypt(chatId),
        chatIdHash: cipher.hash(chatId),
      });
    }
    return user!.id;
  }

  const statuses = async (userId: string) =>
    (
      await db
        .select({
          status: notificationDeliveries.status,
          attempts: notificationDeliveries.attempts,
          lastErrorCode: notificationDeliveries.lastErrorCode,
          deliverAfter: notificationDeliveries.deliverAfter,
        })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.userId, userId))
    ).sort((a, b) => a.status.localeCompare(b.status));

  beforeAll(async () => {
    database = await createTestDatabase();
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    db = drizzle(pool);
  });

  beforeEach(async () => {
    // Each test starts with no due deliveries from earlier tests.
    await db.delete(notificationDeliveries);
    clock = new Date('2026-11-11T08:00:00.000Z');
  });

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it('sends one privacy-preserving summary per user and marks all deliveries sent', async () => {
    const client = new FakeTelegramClient();
    const userId = await userWithChanges({ linked: true, changes: 3, chatId: '424242' });

    const result = await new TelegramDispatcher(db, client, cipher, now).dispatchDue();

    expect(result).toEqual({ sent: 3, retried: 0, failed: 0, skipped: 0 });
    expect(client.sent).toEqual([
      {
        chatId: '424242',
        text: 'CampusWatch: 3 updates\n\n3 grade updates. Open CampusWatch to see the details.',
      },
    ]);
    expect((await statuses(userId)).map((row) => row.status)).toEqual(['sent', 'sent', 'sent']);
    expect(await new TelegramDispatcher(db, client, cipher, now).dispatchDue()).toEqual({
      sent: 0,
      retried: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it('uses detailed text only when the user opted in', async () => {
    const client = new FakeTelegramClient();
    const userId = await userWithChanges({ linked: true, changes: 1 });
    await db.insert(notificationPreferences).values({
      userId,
      settings: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        detailLevel: { chrome: 'summary', telegram: 'detailed' },
      },
    });

    await new TelegramDispatcher(db, client, cipher, now).dispatchDue();

    expect(client.sent[0]?.text).toContain('Updated: CS100 (Total score: 7 → 8.5)');
  });

  it('two workers running at the same time send each delivery once', async () => {
    const client = new FakeTelegramClient();
    await userWithChanges({ linked: true, changes: 2 });
    await userWithChanges({ linked: true, changes: 2 });

    const results = await Promise.all([
      new TelegramDispatcher(db, client, cipher, now).dispatchDue(),
      new TelegramDispatcher(db, client, cipher, now).dispatchDue(),
    ]);

    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(4);
    expect(client.sent).toHaveLength(2);
  });

  it('retries transient failures with backoff, then gives up after 5 attempts', async () => {
    const client = new FakeTelegramClient();
    const userId = await userWithChanges({ linked: true, changes: 1 });
    const dispatcher = new TelegramDispatcher(db, client, cipher, now);

    client.failures.push(new TelegramApiError(502, 'Bad Gateway'));
    expect((await dispatcher.dispatchDue()).retried).toBe(1);
    const [afterFirst] = await statuses(userId);
    expect(afterFirst).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastErrorCode: 'telegram_502',
    });
    expect(afterFirst!.deliverAfter.getTime() - clock.getTime()).toBe(60_000);

    // Not due yet.
    expect((await dispatcher.dispatchDue()).retried).toBe(0);

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      clock = new Date(clock.getTime() + 2 * 60 * 60_000);
      client.failures.push(new TelegramApiError(0, 'network error'));
      await dispatcher.dispatchDue();
    }
    expect(await statuses(userId)).toMatchObject([
      { status: 'failed', attempts: 5, lastErrorCode: 'telegram_0' },
    ]);
    expect(client.sent).toEqual([]);
  });

  it('unlinks a chat that blocked the bot and stops sending', async () => {
    const client = new FakeTelegramClient();
    const userId = await userWithChanges({ linked: true, changes: 2 });
    client.failures.push(new TelegramApiError(403, 'Forbidden: bot was blocked by the user'));

    const result = await new TelegramDispatcher(db, client, cipher, now).dispatchDue();

    expect(result.skipped).toBe(2);
    expect(await db.select().from(telegramLinks).where(eq(telegramLinks.userId, userId))).toEqual(
      [],
    );
    expect((await statuses(userId)).map((row) => row.lastErrorCode)).toEqual([
      'telegram_chat_gone',
      'telegram_chat_gone',
    ]);
  });

  it('skips deliveries of users without a link', async () => {
    const client = new FakeTelegramClient();
    const userId = await userWithChanges({ linked: false, changes: 1 });

    expect((await new TelegramDispatcher(db, client, cipher, now).dispatchDue()).skipped).toBe(1);
    expect(await statuses(userId)).toMatchObject([
      { status: 'skipped', lastErrorCode: 'not_linked' },
    ]);
  });

  it('does not send deliveries that are not due yet (quiet hours)', async () => {
    const client = new FakeTelegramClient();
    const userId = await userWithChanges({ linked: true, changes: 1 });
    await db
      .update(notificationDeliveries)
      .set({ deliverAfter: new Date(clock.getTime() + 60 * 60_000) })
      .where(eq(notificationDeliveries.userId, userId));

    expect((await new TelegramDispatcher(db, client, cipher, now).dispatchDue()).sent).toBe(0);
    clock = new Date(clock.getTime() + 61 * 60_000);
    expect((await new TelegramDispatcher(db, client, cipher, now).dispatchDue()).sent).toBe(1);
  });
});

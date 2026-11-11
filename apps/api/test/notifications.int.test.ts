import { randomUUID } from 'node:crypto';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  deliveryListResponseSchema,
  type NormalizedEntity,
  type NotificationPreferences,
  pendingNotificationsResponseSchema,
  type PortalConnection,
  type RegisterDeviceResponse,
  telegramLinkStartResponseSchema,
  telegramLinkStatusSchema,
} from '@campuswatch/contracts';
import { fingerprintEntity } from '@campuswatch/portal-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  registerUser,
  TEST_TELEGRAM,
  type TestApp,
} from './support/test-app.js';

async function grade(code: string, total: number | null): Promise<NormalizedEntity> {
  const payload = { courseCode: code, courseName: 'Course', totalScore: total };
  const entityType = 'grade_course' as const;
  const externalKey = `2025-2026|1|${code}|`;
  return {
    entityType,
    externalKey,
    payload,
    fingerprint: await fingerprintEntity({ entityType, externalKey, payload }),
  };
}

describe('notifications (integration)', () => {
  let testApp: TestApp;
  const app = () => testApp.app;

  interface Actor {
    accessToken: string;
    deviceToken: string;
    connectionId: string;
  }

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

  async function sync(who: Actor, entities: NormalizedEntity[]) {
    const response = await app().inject({
      method: 'POST',
      url: '/sync-runs',
      headers: bearer(who.deviceToken),
      payload: {
        connectionId: who.connectionId,
        syncRunId: randomUUID(),
        collectedAt: new Date().toISOString(),
        sources: [{ source: 'grades', status: 'ok', entities }],
      },
    });
    expect(response.statusCode).toBe(200);
  }

  const pending = async (who: Actor) =>
    pendingNotificationsResponseSchema.parse(
      (
        await app().inject({
          method: 'GET',
          url: '/notifications/pending',
          headers: bearer(who.deviceToken),
        })
      ).json(),
    );

  const deliveries = async (who: Actor) =>
    deliveryListResponseSchema.parse(
      (
        await app().inject({
          method: 'GET',
          url: '/notifications',
          headers: bearer(who.accessToken),
        })
      ).json(),
    ).deliveries;

  const setPreferences = (who: Actor, preferences: NotificationPreferences) =>
    app().inject({
      method: 'PUT',
      url: '/notification-preferences',
      headers: bearer(who.accessToken),
      payload: preferences,
    });

  const webhook = (text: string, chatId = 777001, secret = TEST_TELEGRAM.TELEGRAM_WEBHOOK_SECRET) =>
    app().inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': secret },
      payload: { update_id: 1, message: { text, chat: { id: chatId, type: 'private' } } },
    });

  beforeAll(async () => {
    testApp = await createTestApp({ telegram: true });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  describe('preferences', () => {
    it('returns privacy-preserving defaults and saves valid updates', async () => {
      const who = await actor('prefs@example.edu');
      const current = await app().inject({
        method: 'GET',
        url: '/notification-preferences',
        headers: bearer(who.accessToken),
      });
      expect(current.json()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
      expect(DEFAULT_NOTIFICATION_PREFERENCES.detailLevel).toEqual({
        chrome: 'summary',
        telegram: 'summary',
      });

      const updated = {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        quietHours: { start: '22:00', end: '07:00' },
      };
      expect((await setPreferences(who, updated)).statusCode).toBe(200);

      const invalid = [
        { ...updated, timezone: 'Mars/Olympus' },
        { ...updated, quietHours: { start: '25:00', end: '07:00' } },
        { ...updated, userId: randomUUID() },
      ];
      for (const body of invalid) {
        expect((await setPreferences(who, body as NotificationPreferences)).statusCode).toBe(400);
      }
    });
  });

  describe('Chrome delivery', () => {
    let alice: Actor;
    let bob: Actor;

    beforeAll(async () => {
      alice = await actor('chrome-alice@example.edu');
      bob = await actor('chrome-bob@example.edu');
      await sync(alice, [await grade('CS101', null)]); // baseline: no notifications
      await sync(alice, [await grade('CS101', 8.4)]); // one change
    });

    it('creates one delivery per change and renders a summary without scores', async () => {
      const batch = await pending(alice);
      expect(batch.deliveryIds).toHaveLength(1);
      expect(batch.notification).toEqual({
        title: 'CampusWatch: 1 update',
        body: '1 grade update. Open CampusWatch to see the details.',
      });
      expect(JSON.stringify(batch)).not.toMatch(/8\.4|CS101/);
    });

    it('a claimed batch is not handed to another device or user, and ack is owner-scoped', async () => {
      expect((await pending(alice)).deliveryIds).toEqual([]); // still claimed
      expect((await pending(bob)).deliveryIds).toEqual([]);

      const [delivery] = await deliveries(alice);
      const bobAck = await app().inject({
        method: 'POST',
        url: '/notifications/ack',
        headers: bearer(bob.deviceToken),
        payload: { deliveryIds: [delivery!.id] },
      });
      expect(bobAck.statusCode).toBe(204);
      expect((await deliveries(alice))[0]?.status).toBe('sending');

      await app().inject({
        method: 'POST',
        url: '/notifications/ack',
        headers: bearer(alice.deviceToken),
        payload: { deliveryIds: [delivery!.id] },
      });
      expect((await deliveries(alice))[0]).toMatchObject({ status: 'sent', channel: 'chrome' });
      expect(await deliveries(bob)).toEqual([]);
    });

    it('respects disabled categories', async () => {
      await setPreferences(alice, {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        channels: {
          ...DEFAULT_NOTIFICATION_PREFERENCES.channels,
          chrome: { ...DEFAULT_NOTIFICATION_PREFERENCES.channels.chrome, grades: false },
        },
      });
      await sync(alice, [await grade('CS101', 9)]);
      expect((await pending(alice)).deliveryIds).toEqual([]);
    });

    it('uses detailed text only when the user opted in', async () => {
      await setPreferences(alice, {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        detailLevel: { chrome: 'detailed', telegram: 'summary' },
      });
      await sync(alice, [await grade('CS101', 9.5)]);
      expect((await pending(alice)).notification?.body).toBe(
        'Updated: CS101 Course (Total score: 9 → 9.5)',
      );
    });

    it('requires a device token for pending notifications', async () => {
      const response = await app().inject({
        method: 'GET',
        url: '/notifications/pending',
        headers: bearer(alice.accessToken),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('quiet hours', () => {
    it('delays non-urgent notifications but not grades', async () => {
      const who = await actor('quiet@example.edu');
      // Quiet all day except one minute, so the test does not depend on the clock.
      const now = new Date();
      const hh = (offset: number) =>
        new Date(now.getTime() + offset * 60_000).toISOString().slice(11, 16);
      await setPreferences(who, {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        timezone: 'UTC',
        // Quiet from 4 minutes ago until 5 minutes ago tomorrow (wraps past midnight).
        quietHours: { start: hh(-4), end: hh(-5) },
      });
      const exam = async (room: string) => {
        const payload = { courseCode: 'CS101', room };
        const externalKey = '2025-2026|1|CS101|2026-01-10|Ca 1';
        return {
          entityType: 'exam' as const,
          externalKey,
          payload,
          fingerprint: await fingerprintEntity({ entityType: 'exam', externalKey, payload }),
        };
      };
      const upload = async (entities: NormalizedEntity[], source: 'exams' | 'grades') =>
        app().inject({
          method: 'POST',
          url: '/sync-runs',
          headers: bearer(who.deviceToken),
          payload: {
            connectionId: who.connectionId,
            syncRunId: randomUUID(),
            collectedAt: new Date().toISOString(),
            sources: [{ source, status: 'ok', entities }],
          },
        });
      await upload([await exam('A1')], 'exams');
      await upload([await exam('B2')], 'exams');
      await upload([await grade('MA101', null)], 'grades');
      await upload([await grade('MA101', 7)], 'grades');

      const list = await deliveries(who);
      const examDelivery = list.find((d) => d.category === 'exams');
      const gradeDelivery = list.find((d) => d.category === 'grades');
      expect(Date.parse(examDelivery!.deliverAfter)).toBeGreaterThan(Date.now() + 60 * 60_000);
      expect(Date.parse(gradeDelivery!.deliverAfter)).toBeLessThanOrEqual(Date.now());
      expect((await pending(who)).deliveryIds).toEqual([gradeDelivery!.id]);
    });
  });

  describe('Telegram linking', () => {
    let carol: Actor;
    let dave: Actor;

    beforeAll(async () => {
      carol = await actor('carol@example.edu');
      dave = await actor('dave@example.edu');
    });

    const start = async (who: Actor) =>
      telegramLinkStartResponseSchema.parse(
        (
          await app().inject({
            method: 'POST',
            url: '/telegram/link/start',
            headers: bearer(who.accessToken),
          })
        ).json(),
      );
    const status = async (who: Actor) =>
      telegramLinkStatusSchema.parse(
        (
          await app().inject({
            method: 'GET',
            url: '/telegram/link',
            headers: bearer(who.accessToken),
          })
        ).json(),
      );
    const codeOf = (deepLink: string) => new URL(deepLink).searchParams.get('start')!;

    it('rejects webhook calls without the secret token', async () => {
      const { deepLink } = await start(carol);
      expect((await webhook(`/start ${codeOf(deepLink)}`, 1, 'wrong-secret')).statusCode).toBe(401);
      const noHeader = await app().inject({
        method: 'POST',
        url: '/telegram/webhook',
        payload: { update_id: 1 },
      });
      expect(noHeader.statusCode).toBe(401);
      expect((await status(carol)).linked).toBe(false);
    });

    it('links with a one-time code and stores the chat id encrypted', async () => {
      const { deepLink } = await start(carol);
      expect(deepLink).toMatch(/^https:\/\/t\.me\/CampusWatchTestBot\?start=[A-Za-z0-9_-]{32}$/);

      expect((await webhook(`/start ${codeOf(deepLink)}`, 777001)).statusCode).toBe(200);
      expect((await status(carol)).linked).toBe(true);
      expect(testApp.telegram.sent.at(-1)).toMatchObject({ chatId: '777001' });

      const client = new pg.Client({ connectionString: testApp.databaseUrl });
      await client.connect();
      try {
        const { rows } = await client.query<{ chat: string }>(
          'select chat_id_encrypted as chat from telegram_links',
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.chat).not.toContain('777001');
        const nonces = await client.query<{ hash: string }>(
          'select nonce_hash as hash from telegram_link_nonces',
        );
        expect(nonces.rows.every((row) => !deepLink.includes(row.hash))).toBe(true);
      } finally {
        await client.end();
      }
    });

    it('a code cannot be reused, and only the newest code works', async () => {
      const first = codeOf((await start(dave)).deepLink);
      const second = codeOf((await start(dave)).deepLink);

      await webhook(`/start ${first}`, 888001);
      expect((await status(dave)).linked).toBe(false);
      expect(testApp.telegram.sent.at(-1)?.text).toMatch(/expired or was already used/);

      await webhook(`/start ${second}`, 888001);
      expect((await status(dave)).linked).toBe(true);
      await webhook(`/start ${second}`, 999001);
      expect(testApp.telegram.sent.at(-1)?.text).toMatch(/expired or was already used/);
    });

    it('creates Telegram deliveries only for linked users, and unlink cancels them', async () => {
      await sync(carol, [await grade('CS101', null)]);
      await sync(carol, [await grade('CS101', 6)]);
      const telegramPending = (await deliveries(carol)).filter((d) => d.channel === 'telegram');
      expect(telegramPending.map((d) => d.status)).toEqual(['pending']);

      const unlink = await app().inject({
        method: 'DELETE',
        url: '/telegram/link',
        headers: bearer(carol.accessToken),
      });
      expect(unlink.statusCode).toBe(204);
      expect((await status(carol)).linked).toBe(false);
      const after = (await deliveries(carol)).filter((d) => d.channel === 'telegram');
      expect(after.map((d) => [d.status, d.lastErrorCode])).toEqual([['skipped', 'unlinked']]);

      await sync(carol, [await grade('CS101', 7)]);
      expect((await deliveries(carol)).filter((d) => d.channel === 'telegram')).toHaveLength(1);
    });

    it('/stop from the chat unlinks it', async () => {
      await webhook('/stop', 888001);
      expect((await status(dave)).linked).toBe(false);
    });

    it('ignores group chats', async () => {
      const code = codeOf((await start(carol)).deepLink);
      await app().inject({
        method: 'POST',
        url: '/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': TEST_TELEGRAM.TELEGRAM_WEBHOOK_SECRET },
        payload: {
          update_id: 2,
          message: { text: `/start ${code}`, chat: { id: -100, type: 'group' } },
        },
      });
      expect((await status(carol)).linked).toBe(false);
    });
  });
});

describe('Telegram disabled (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('reports Telegram as unavailable and refuses to start linking', async () => {
    const { accessToken } = await registerUser(testApp.app, 'notelegram@example.edu');
    const status = await testApp.app.inject({
      method: 'GET',
      url: '/telegram/link',
      headers: bearer(accessToken),
    });
    expect(status.json()).toEqual({ available: false, linked: false, linkedAt: null });
    const start = await testApp.app.inject({
      method: 'POST',
      url: '/telegram/link/start',
      headers: bearer(accessToken),
    });
    expect(start.statusCode).toBe(503);
    expect(start.json()).toMatchObject({ code: 'telegram_unavailable' });
    const hook = await testApp.app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'anything' },
      payload: { update_id: 1 },
    });
    expect(hook.statusCode).toBe(401);
  });
});

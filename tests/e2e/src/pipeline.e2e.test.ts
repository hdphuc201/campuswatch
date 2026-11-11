import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CITD_ORIGIN,
  CITD_PAGE_PATHS,
  type CollectorRequest,
  type CollectorResponse,
  runCollector,
} from '@campuswatch/citd-adapter';
import type { RenderedNotification } from '@campuswatch/contracts';
import { createChatIdCipher, FakeTelegramClient } from '@campuswatch/notifications/server';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Window } from 'happy-dom';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The real application code under test, imported from source.
import {
  createTestApp,
  TEST_TELEGRAM,
  type TestApp,
} from '../../../apps/api/test/support/test-app.js';
import { CitdExtensionAdapter } from '../../../apps/extension/src/adapters/citd/citd-extension-adapter.js';
import { CampusWatchApi } from '../../../apps/extension/src/api/client.js';
import { ExtensionController } from '../../../apps/extension/src/background/controller.js';
import {
  ALLOWED_STATE_KEYS,
  ExtensionState,
} from '../../../apps/extension/src/storage/extension-state.js';
import { createMemoryStore } from '../../../apps/extension/src/storage/key-value-store.js';
import { SyncEngine } from '../../../apps/extension/src/sync/engine.js';
import { Outbox } from '../../../apps/extension/src/sync/outbox.js';
import { TelegramDispatcher } from '../../../apps/worker/src/notifications/telegram-dispatcher.js';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/citd-adapter/fixtures',
);
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const PASSWORD = 'pilot test password 2026';

/**
 * A simulated CITD Portal for one logged-in student, served to the real collector exactly as
 * the injected script would see it (same-origin GET requests from the Portal tab).
 */
function createPortal() {
  const pages = new Map<string, string>([
    [CITD_PAGE_PATHS.dashboard, fixture('dashboard.html')],
    [CITD_PAGE_PATHS.grades, fixture('grades.html')],
    [CITD_PAGE_PATHS.tuition, fixture('tuition.html')],
    [CITD_PAGE_PATHS.timetable, fixture('timetable.html')],
    [CITD_PAGE_PATHS.exams, fixture('exams-none.html')],
  ]);
  const requests: string[] = [];
  let loggedIn = true;
  const window = new Window({ url: CITD_ORIGIN });

  const driver = {
    run(request: CollectorRequest): Promise<CollectorResponse> {
      return runCollector(request, {
        origin: CITD_ORIGIN,
        parseHtml: (html) =>
          new window.DOMParser().parseFromString(html, 'text/html') as unknown as Document,
        fetch: (input, init) => {
          const url = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          );
          requests.push(`${init?.method ?? 'GET'} ${url.pathname}`);
          const body = loggedIn ? pages.get(url.pathname) : fixture('login.html');
          const response = new Response(body ?? 'not found', { status: body ? 200 : 404 });
          Object.defineProperty(response, 'url', {
            value: loggedIn ? url.href : `${CITD_ORIGIN}/Account/Login`,
          });
          return Promise.resolve(response);
        },
      });
    },
    release: () => Promise.resolve(),
  };
  return {
    driver,
    requests,
    setPage: (path: string, html: string) => pages.set(path, html),
    logOut: () => {
      loggedIn = false;
    },
  };
}

describe('pilot pipeline end to end', () => {
  let testApp: TestApp;
  let pool: pg.Pool;
  const portal = createPortal();
  const shown: RenderedNotification[] = [];
  const opened: string[] = [];
  const store = createMemoryStore();
  let clock = new Date();
  let controller: ExtensionController;
  let engine: SyncEngine;

  beforeAll(async () => {
    testApp = await createTestApp({ telegram: true });
    pool = new pg.Pool({ connectionString: testApp.databaseUrl, max: 2 });

    // The extension's real API client, talking to the real API in-process over HTTP semantics.
    const fetchViaApi: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      const response = await testApp.app.inject({
        method: (init?.method ?? 'GET') as 'GET',
        url: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        ...(init?.body ? { payload: init.body as string } : {}),
      });
      return new Response(response.statusCode === 204 ? null : response.body, {
        status: response.statusCode,
        headers: { 'content-type': String(response.headers['content-type'] ?? 'application/json') },
      });
    };
    const state = new ExtensionState(store);
    const api = new CampusWatchApi({ baseUrl: 'https://api.test', fetch: fetchViaApi, state });
    const adapter = new CitdExtensionAdapter(portal.driver);
    const scheduler = { schedule: () => Promise.resolve(), clear: () => Promise.resolve() };
    engine = new SyncEngine({
      state,
      api,
      outbox: new Outbox(store, () => clock.getTime()),
      scheduler,
      adapter,
      now: () => clock,
      notifier: {
        show: (notification) => {
          shown.push(notification);
          return Promise.resolve();
        },
      },
    });
    controller = new ExtensionController({
      state,
      api,
      engine,
      scheduler,
      extensionVersion: '0.1.0',
      adapterAvailable: true,
      adapterBeta: true,
      now: () => clock,
      openUrl: (url) => {
        opened.push(url);
        return Promise.resolve();
      },
    });
  });

  afterAll(async () => {
    await pool?.end();
    await testApp?.close();
  });

  it('1. registers, consents, connects, and stores the first sync as a baseline', async () => {
    expect(
      await controller.handle({ type: 'register', email: 'pilot@example.edu', password: PASSWORD }),
    ).toMatchObject({ ok: true });

    const connected = await controller.handle({ type: 'connect' });
    expect(connected).toMatchObject({
      ok: true,
      outcome: { status: 'completed', result: 'ok' },
      view: { connection: { status: 'CONNECTED' } },
    });
    // Read-only: every Portal request was a GET.
    expect(portal.requests.every((request) => request.startsWith('GET '))).toBe(true);

    const { rows } = await pool.query<{ type: string; n: number }>(
      'select entity_type as type, count(*)::int as n from entities group by 1 order by 1',
    );
    expect(Object.fromEntries(rows.map((row) => [row.type, row.n]))).toEqual({
      grade_course: 4,
      grade_summary: 2,
      portal_notice: 1,
      timetable_class: 3,
      tuition_course: 3,
      tuition_term: 2,
    });
    const changes = await controller.handle({ type: 'getChanges' });
    expect(changes.ok && changes.changes).toEqual([]);
    expect(shown).toEqual([]);
  });

  it('2. links Telegram through the bot deep link and webhook', async () => {
    await controller.handle({ type: 'telegramLink' });
    const code = new URL(opened.at(-1)!).searchParams.get('start');
    const webhook = await testApp.app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': TEST_TELEGRAM.TELEGRAM_WEBHOOK_SECRET },
      payload: {
        update_id: 1,
        message: { text: `/start ${code}`, chat: { id: 5550001, type: 'private' } },
      },
    });
    expect(webhook.statusCode).toBe(200);
    const settings = await controller.handle({ type: 'getSettings' });
    expect(settings.ok && settings.settings?.telegram.linked).toBe(true);
  });

  it('3. detects a regrade, a new course, and a new exam schedule, and notifies once', async () => {
    portal.setPage(CITD_PAGE_PATHS.grades, fixture('grades-changed.html'));
    portal.setPage(CITD_PAGE_PATHS.exams, fixture('exams.html'));
    clock = new Date(clock.getTime() + 31 * 60_000);

    expect(await engine.run('alarm')).toEqual({ status: 'completed', result: 'ok' });

    const changes = await controller.handle({ type: 'getChanges' });
    const summary = (changes.ok ? (changes.changes ?? []) : [])
      .map((change) => `${change.kind} ${change.entityType} ${change.externalKey}`)
      .sort();
    expect(summary).toEqual([
      'ADDED exam 2025-2026|2|CS102|2026-05-20|Ca 1',
      'ADDED exam 2025-2026|2|EN101|2026-05-22|Ca 3',
      'ADDED grade_course 2025-2026|2|EN101|EN101.01',
      'UPDATED grade_course 2025-2026|1|CS101|',
      'UPDATED grade_summary 2025-2026|1',
      'UPDATED grade_summary cumulative',
    ]);

    // Chrome: one summary notification for the batch, without scores.
    expect(shown).toEqual([
      {
        title: 'CampusWatch: 6 updates',
        body: '4 grade updates, 2 exam schedule changes. Open CampusWatch to see the details.',
      },
    ]);

    // Telegram: the worker's dispatcher sends one summary message to the linked chat.
    const telegram = new FakeTelegramClient();
    const dispatcher = new TelegramDispatcher(
      drizzle(pool),
      telegram,
      createChatIdCipher(TEST_TELEGRAM.ENCRYPTION_KEY),
    );
    expect((await dispatcher.dispatchDue()).sent).toBe(6);
    expect(telegram.sent).toEqual([
      {
        chatId: '5550001',
        text: 'CampusWatch: 6 updates\n\n4 grade updates, 2 exam schedule changes. Open CampusWatch to see the details.',
      },
    ]);

    // A retried or repeated sync of the same data creates nothing new.
    clock = new Date(clock.getTime() + 31 * 60_000);
    await engine.run('alarm');
    const again = await controller.handle({ type: 'getChanges' });
    expect(again.ok && again.changes).toHaveLength(6);
    expect(shown).toHaveLength(1);
  });

  it('4. reports LOGIN_REQUIRED when the Portal session expires and stops polling', async () => {
    portal.logOut();
    clock = new Date(clock.getTime() + 31 * 60_000);

    expect(await engine.run('alarm')).toEqual({ status: 'completed', result: 'login_required' });
    const view = await controller.view();
    expect(view.connection?.status).toBe('LOGIN_REQUIRED');
    expect(view.sync.polling).toBe('stopped');
  });

  it('5. never stores Portal secrets or page HTML in the extension or the database', async () => {
    const keys = await store.keys();
    expect(keys.every((key) => ALLOWED_STATE_KEYS.includes(key))).toBe(true);
    const local = JSON.stringify(await Promise.all(keys.map((key) => store.get(key))));
    expect(local).not.toMatch(/<html|<table|<td|password|cookie|csrf/i);

    const { rows } = await pool.query<{ dump: string }>(
      `select coalesce((select string_agg(payload::text, ' ') from entities), '') ||
              coalesce((select string_agg(payload::text || changed_fields::text, ' ') from change_events), '') ||
              coalesce((select string_agg(source_results::text, ' ') from sync_runs), '') as dump`,
    );
    expect(rows[0]?.dump).not.toMatch(/<html|<table|<td|cookie|csrf|viewstate|authorization/i);
    expect(testApp.logs.join('\n')).not.toMatch(/pilot@example\.edu|5550001|Nhập môn/);
  });

  it('6. exports and then deletes the account completely', async () => {
    const exported = await controller.handle({ type: 'exportData', password: PASSWORD });
    expect(exported.ok && exported.export?.entities.length).toBeGreaterThan(0);

    expect(await controller.handle({ type: 'deleteAccount', password: PASSWORD })).toMatchObject({
      ok: true,
      view: { signedIn: false },
    });
    const { rows } = await pool.query<{ n: number }>(
      `select (select count(*) from users) + (select count(*) from entities)
            + (select count(*) from change_events) + (select count(*) from telegram_links)
            + (select count(*) from notification_deliveries) as n`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
    expect(await store.keys()).toEqual([]);
  });
});

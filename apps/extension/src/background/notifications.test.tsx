import { DEFAULT_NOTIFICATION_PREFERENCES } from '@campuswatch/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeliveryList, SettingsForm, TelegramSection } from '../options/settings-form.js';
import { createHarness } from '../test/harness.js';

const noop = () => undefined;

async function connected() {
  const harness = createHarness();
  await harness.controller.handle({
    type: 'register',
    email: 'notify@example.edu',
    password: 'a long enough password',
  });
  await harness.controller.handle({ type: 'connect' });
  return harness;
}

describe('Chrome notifications', () => {
  it('shows due notifications after a sync and acknowledges them', async () => {
    const harness = await connected();
    harness.backend.notifications.pending = {
      notification: { title: 'CampusWatch: 1 update', body: '1 grade update.' },
      deliveryIds: ['00000000-0000-4000-8000-000000000099'],
    };

    await harness.engine.run('alarm');

    expect(harness.shown).toEqual([{ title: 'CampusWatch: 1 update', body: '1 grade update.' }]);
    expect(harness.backend.acked).toEqual(['00000000-0000-4000-8000-000000000099']);
  });

  it('does not acknowledge when showing fails, so the batch is retried later', async () => {
    const harness = await connected();
    harness.backend.notifications.pending = {
      notification: { title: 't', body: 'b' },
      deliveryIds: ['00000000-0000-4000-8000-000000000098'],
    };
    harness.backend.setOffline(false);
    const original = harness.shown.push.bind(harness.shown);
    harness.shown.push = () => {
      throw new Error('notifications blocked');
    };

    await harness.engine.run('alarm');

    harness.shown.push = original;
    expect(harness.backend.acked).toEqual([]);
  });
});

describe('settings commands', () => {
  it('loads and saves preferences', async () => {
    const { controller, backend } = await connected();

    const loaded = await controller.handle({ type: 'getSettings' });
    expect(loaded.ok && loaded.settings?.preferences).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);

    const preferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      quietHours: { start: '22:00', end: '06:30' },
    };
    const saved = await controller.handle({ type: 'savePreferences', preferences });
    expect(saved.ok && saved.settings?.preferences.quietHours).toEqual({
      start: '22:00',
      end: '06:30',
    });
    expect(backend.notifications.preferences).toEqual(preferences);
  });

  it('rejects invalid preferences before calling the API', async () => {
    const { controller, backend } = await connected();
    const invalid = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      quietHours: { start: '9pm', end: '7am' },
    };

    expect(
      await controller.handle({ type: 'savePreferences', preferences: invalid }),
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(backend.calls).not.toContain('PUT /notification-preferences');
  });

  it('opens the Telegram deep link and reports when Telegram is unavailable', async () => {
    const harness = await connected();
    await harness.controller.handle({ type: 'telegramLink' });
    expect(harness.opened).toEqual([
      'https://t.me/CampusWatchBot?start=abcdefghijklmnopqrstuvwxyz012345',
    ]);

    harness.backend.notifications.telegramAvailable = false;
    expect(await harness.controller.handle({ type: 'telegramLink' })).toMatchObject({
      ok: false,
      error: { code: 'telegram_unavailable' },
    });
  });
});

describe('options page components', () => {
  it('defaults to summary messages and explains what detailed means', () => {
    const html = renderToStaticMarkup(
      <SettingsForm preferences={DEFAULT_NOTIFICATION_PREFERENCES} busy={false} onSave={noop} />,
    );
    expect(html).toContain('Summary (recommended)');
    expect(html).toContain('Detailed messages include course names, scores, and amounts');
    expect(html).toContain('Grades and tuition are always sent right away');
  });

  it('shows the Telegram states', () => {
    const unavailable = renderToStaticMarkup(
      <TelegramSection
        status={{ available: false, linked: false, linkedAt: null }}
        busy={false}
        onLink={noop}
        onUnlink={noop}
      />,
    );
    expect(unavailable).toContain('not available yet');
    const unlinked = renderToStaticMarkup(
      <TelegramSection
        status={{ available: true, linked: false, linkedAt: null }}
        busy={false}
        onLink={noop}
        onUnlink={noop}
      />,
    );
    expect(unlinked).toContain('never need to enter a bot token or chat ID');
  });

  it('lists delivery statuses, including quiet-hours delays', () => {
    const html = renderToStaticMarkup(
      <DeliveryList
        now={new Date()}
        deliveries={[
          {
            id: '00000000-0000-4000-8000-000000000001',
            changeEventId: '00000000-0000-4000-8000-000000000002',
            channel: 'telegram',
            category: 'exams',
            status: 'pending',
            attempts: 0,
            deliverAfter: new Date(Date.now() + 3_600_000).toISOString(),
            sentAt: null,
            lastErrorCode: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );
    expect(html).toContain('Waiting (quiet hours)');
  });
});

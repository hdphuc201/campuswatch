import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExtensionView } from '../messaging.js';
import { INITIAL_SYNC_STATE } from '../storage/extension-state.js';
import { AuthForm, ConsentView, Dashboard } from './components.js';
import { describeStatus } from './status.js';

const NOW = new Date('2026-11-11T08:00:00.000Z');
const noop = () => undefined;

function view(patch: Partial<ExtensionView> = {}): ExtensionView {
  return {
    signedIn: true,
    email: 'student@example.edu',
    deviceRegistered: true,
    connection: {
      id: '00000000-0000-4000-8000-000000000001',
      status: 'CONNECTED',
      consentVersion: '2026-11',
      lastSyncAt: null,
    },
    sync: INITIAL_SYNC_STATE,
    adapterAvailable: true,
    consentVersion: '2026-11',
    ...patch,
  };
}

describe('describeStatus', () => {
  it('shows "Connected" only after the Portal was actually read', () => {
    expect(describeStatus(view(), NOW).title).toBe('Waiting for the first check');
    expect(
      describeStatus(
        view({
          sync: {
            ...INITIAL_SYNC_STATE,
            lastResult: 'ok',
            lastSuccessAt: '2026-11-11T07:50:00.000Z',
          },
        }),
        NOW,
      ),
    ).toMatchObject({ tone: 'ok', title: 'Connected', detail: 'Last checked 10 min ago.' });
  });

  it('explains each failure state', () => {
    const titles = (
      [
        'login_required',
        'network_error',
        'portal_unavailable',
        'adapter_needs_update',
        'device_revoked',
      ] as const
    ).map(
      (lastResult) =>
        describeStatus(view({ sync: { ...INITIAL_SYNC_STATE, lastResult } }), NOW).title,
    );

    expect(titles).toEqual([
      'Log in to the CITD Portal',
      'Cannot reach CampusWatch',
      'CITD Portal is not responding',
      'CampusWatch needs an update',
      'This browser was signed out',
    ]);
  });

  it('prefers Paused and "not available" over stale sync results', () => {
    const stale = { ...INITIAL_SYNC_STATE, lastResult: 'ok' as const };
    expect(
      describeStatus(
        view({ sync: stale, connection: { ...view().connection!, status: 'PAUSED' } }),
        NOW,
      ).title,
    ).toBe('Paused');
    expect(describeStatus(view({ sync: stale, adapterAvailable: false }), NOW).title).toBe(
      'Portal reading not available yet',
    );
  });
});

describe('popup screens', () => {
  it('auth form warns never to enter the Portal password', () => {
    const html = renderToStaticMarkup(<AuthForm busy={false} onSubmit={noop} />);
    expect(html).toContain('Never enter your Portal password here');
  });

  it('consent view states the Chrome-only limit and what is never collected', () => {
    const html = renderToStaticMarkup(
      <ConsentView busy={false} onAccept={noop} onSignOut={noop} />,
    );
    expect(html).toContain('only while Chrome is running');
    expect(html).toContain('Nothing is checked while Chrome or your computer is off');
    expect(html).toContain('Portal password, cookies, or page contents');
  });

  it('dashboard offers Resume while paused and disables Sync now', () => {
    const html = renderToStaticMarkup(
      <Dashboard
        view={view({ connection: { ...view().connection!, status: 'PAUSED' } })}
        now={NOW}
        busy={false}
        onCommand={noop}
      />,
    );
    expect(html).toContain('Resume');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Sync now<\/button>/);
  });
});

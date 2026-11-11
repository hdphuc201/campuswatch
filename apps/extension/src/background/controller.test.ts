import { describe, expect, it } from 'vitest';
import { isCommand } from '../messaging.js';
import { ALLOWED_STATE_KEYS } from '../storage/extension-state.js';
import { createHarness, type FakeAdapter } from '../test/harness.js';

const PASSWORD = 'a long enough password';

describe('extension lifecycle', () => {
  it('runs the critical path: register, connect, probe, pause, resume, disconnect, sign out', async () => {
    const { controller, backend, store, state, scheduler } = createHarness();

    const registered = await controller.handle({
      type: 'register',
      email: ' Student@Example.EDU ',
      password: PASSWORD,
    });
    expect(registered).toMatchObject({
      ok: true,
      view: { signedIn: true, email: 'student@example.edu', deviceRegistered: true },
    });

    const connected = await controller.handle({ type: 'connect' });
    expect(connected).toMatchObject({
      ok: true,
      outcome: { status: 'completed', result: 'ok' },
      view: { connection: { status: 'CONNECTED' } },
    });

    const paused = await controller.handle({ type: 'pause' });
    expect(paused.view.connection?.status).toBe('PAUSED');
    expect(scheduler.active).toBeNull();
    expect(await controller.handle({ type: 'syncNow' })).toMatchObject({
      outcome: { status: 'skipped', reason: 'paused' },
    });

    const resumed = await controller.handle({ type: 'resume' });
    expect(resumed.view.connection?.status).toBe('CONNECTED');

    await controller.handle({ type: 'disconnect' });
    expect(backend.connections.size).toBe(0);
    expect(await state.getConnection()).toBeUndefined();
    expect(scheduler.active).toBeNull();

    const device = await state.getDevice();
    await controller.handle({ type: 'signOut' });
    expect(backend.devices.get(device!.id)?.revoked).toBe(true);
    expect(await store.keys()).toEqual([]);
  });

  it('only ever stores CampusWatch credentials and sync bookkeeping', async () => {
    const { controller, store } = createHarness();
    await controller.handle({ type: 'register', email: 'keys@example.edu', password: PASSWORD });
    await controller.handle({ type: 'connect' });
    await controller.handle({ type: 'syncNow' });

    const keys = await store.keys();
    expect(keys.every((key) => ALLOWED_STATE_KEYS.includes(key))).toBe(true);
    const serialized = JSON.stringify(
      await Promise.all(keys.map((key) => store.get(key))),
    ).toLowerCase();
    expect(serialized).not.toMatch(/password|cookie|csrf|<html|<table/);
  });

  it('never exposes tokens in the view sent to the popup', async () => {
    const { controller } = createHarness();
    const result = await controller.handle({
      type: 'register',
      email: 'view@example.edu',
      password: PASSWORD,
    });

    expect(JSON.stringify(result)).not.toMatch(/access-|cwr_|cwd_/);
  });

  it('adopts the existing connection when signing in on a second browser', async () => {
    const first = createHarness();
    await first.controller.handle({
      type: 'register',
      email: 'two@example.edu',
      password: PASSWORD,
    });
    await first.controller.handle({ type: 'connect' });

    // Same backend, new browser profile.
    const { controller } = createHarness({ backend: first.backend });

    const result = await controller.handle({
      type: 'signIn',
      email: 'two@example.edu',
      password: PASSWORD,
    });
    expect(result.view.connection?.id).toBe((await first.state.getConnection())?.id);
    expect(first.backend.devices.size).toBe(2);
  });

  it('maps API failures to user-facing error codes', async () => {
    const { controller, backend } = createHarness();
    await controller.handle({ type: 'register', email: 'err@example.edu', password: PASSWORD });

    expect(
      await controller.handle({ type: 'register', email: 'err@example.edu', password: PASSWORD }),
    ).toMatchObject({ ok: false, error: { code: 'email_taken' } });
    expect(
      await controller.handle({ type: 'signIn', email: 'err@example.edu', password: 'wrong' }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_credentials' } });

    await controller.handle({ type: 'signIn', email: 'err@example.edu', password: PASSWORD });
    backend.setOffline(true);
    expect(await controller.handle({ type: 'connect' })).toMatchObject({
      ok: false,
      error: { code: 'network' },
    });
  });

  it('signs out locally when the CampusWatch session has ended', async () => {
    const { controller, backend, state } = createHarness();
    await controller.handle({ type: 'register', email: 'end@example.edu', password: PASSWORD });
    const session = await state.getSession();
    await state.setSession({ ...session!, refreshToken: 'cwr_revoked' });
    backend.expireAccessTokens();

    const result = await controller.handle({ type: 'connect' });

    expect(result).toMatchObject({ ok: false, error: { code: 'session_expired' } });
    expect(result.view.signedIn).toBe(false);
  });

  it('re-checks the Portal at most every 2 minutes when a Portal page loads', async () => {
    const harness = createHarness();
    await harness.controller.handle({
      type: 'register',
      email: 'tab@example.edu',
      password: PASSWORD,
    });
    const adapter = harness.adapter as FakeAdapter;
    adapter.probeState = 'login_required';
    await harness.controller.handle({ type: 'connect' });
    const probes = adapter.probes;

    await harness.controller.onPortalPageLoaded();
    await harness.controller.onPortalPageLoaded();
    expect(adapter.probes).toBe(probes + 1);
  });
});

describe('isCommand', () => {
  it('accepts well-formed commands and rejects everything else', () => {
    expect(isCommand({ type: 'syncNow' })).toBe(true);
    expect(isCommand({ type: 'signIn', email: 'a@b.c', password: 'x' })).toBe(true);
    expect(isCommand({ type: 'signIn' })).toBe(false);
    expect(isCommand({ type: 'deleteEverything' })).toBe(false);
    expect(isCommand('syncNow')).toBe(false);
    expect(isCommand(null)).toBe(false);
  });
});

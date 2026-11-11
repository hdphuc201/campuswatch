import { describe, expect, it } from 'vitest';
import { createHarness, FakeAdapter } from '../test/harness.js';

async function connected(options: Parameters<typeof createHarness>[0] = {}) {
  const harness = createHarness(options);
  await harness.controller.handle({
    type: 'register',
    email: 'engine@example.edu',
    password: 'a long enough password',
  });
  await harness.controller.handle({ type: 'connect' });
  return harness;
}

describe('SyncEngine', () => {
  it('skips and clears the alarm when signed out or not connected', async () => {
    const harness = createHarness();
    expect(await harness.engine.run('alarm')).toEqual({ status: 'skipped', reason: 'signed_out' });

    await harness.controller.handle({
      type: 'register',
      email: 'x@example.edu',
      password: 'a long enough password',
    });
    expect(await harness.engine.run('alarm')).toEqual({
      status: 'skipped',
      reason: 'no_connection',
    });
    expect(harness.scheduler.active).toBeNull();
  });

  it('syncs right after connecting and schedules the next run about 30 minutes later', async () => {
    const { state, scheduler, backend } = await connected();

    expect((await state.getConnection())?.status).toBe('CONNECTED');
    expect((await state.getSync()).lastResult).toBe('ok');
    expect(scheduler.active).toBe(30);
    // Logged in: the snapshot upload carries the session state (no separate probe report).
    expect(backend.calls).toContain('POST /sync-runs');
  });

  it('stops polling on LOGIN_REQUIRED and resumes after a Portal login', async () => {
    const harness = await connected();
    const adapter = harness.adapter as FakeAdapter;
    adapter.probeState = 'login_required';

    await harness.engine.run('alarm');
    expect(await harness.state.getSync()).toMatchObject({
      lastResult: 'login_required',
      polling: 'stopped',
    });
    expect(harness.scheduler.active).toBeNull();
    expect((await harness.state.getConnection())?.status).toBe('LOGIN_REQUIRED');

    // A stray alarm does not touch the Portal while polling is stopped.
    const probes = adapter.probes;
    expect(await harness.engine.run('alarm')).toEqual({
      status: 'skipped',
      reason: 'polling_stopped',
    });
    expect(adapter.probes).toBe(probes);

    adapter.probeState = 'authenticated';
    await harness.controller.onPortalPageLoaded();
    expect(await harness.state.getSync()).toMatchObject({ lastResult: 'ok', polling: 'active' });
    expect(harness.scheduler.active).toBe(30);
  });

  it('retries 3 times with backoff, then reports the error and returns to normal cadence', async () => {
    const harness = await connected();
    (harness.adapter as FakeAdapter).probeState = 'unavailable';

    const delays: number[] = [];
    for (let run = 0; run < 4; run += 1) {
      await harness.engine.run('alarm');
      delays.push(harness.scheduler.active!);
    }

    expect(delays).toEqual([5, 15, 45, 30]);
    expect(await harness.state.getSync()).toMatchObject({
      lastResult: 'portal_unavailable',
      consecutiveFailures: 0,
    });
  });

  it('queues the probe report when the API is unreachable and delivers it later', async () => {
    const harness = await connected();
    (harness.adapter as FakeAdapter).probeState = 'login_required';
    harness.backend.setOffline(true);

    await harness.engine.run('manual');
    expect((await harness.state.getSync()).lastResult).toBe('network_error');
    expect(await harness.outbox.list()).toHaveLength(1);

    harness.backend.setOffline(false);
    (harness.adapter as FakeAdapter).probeState = 'authenticated';
    harness.clock.advanceMinutes(5);
    await harness.engine.run('alarm');

    expect(await harness.outbox.list()).toEqual([]);
    expect((await harness.state.getConnection())?.status).toBe('CONNECTED');
  });

  it('rate-limits manual syncs to one per 5 minutes', async () => {
    const harness = await connected();

    expect((await harness.engine.run('manual')).status).toBe('completed');
    expect((await harness.engine.run('manual')).status).toBe('cooldown');
    harness.clock.advanceMinutes(5);
    expect((await harness.engine.run('manual')).status).toBe('completed');
  });

  it('keeps the normal cadence on parser drift instead of retrying quickly', async () => {
    const harness = await connected();
    (harness.adapter as FakeAdapter).probeError = new Error('drift');

    await harness.engine.run('alarm');

    expect((await harness.state.getSync()).lastResult).toBe('adapter_needs_update');
    expect(harness.scheduler.active).toBe(30);
  });

  it('stops and forgets the device when its token was revoked elsewhere', async () => {
    const harness = await connected();
    const device = await harness.state.getDevice();
    harness.backend.devices.get(device!.id)!.revoked = true;

    await harness.engine.run('alarm');

    expect(await harness.state.getSync()).toMatchObject({
      lastResult: 'device_revoked',
      polling: 'stopped',
    });
    expect(await harness.state.getDevice()).toBeUndefined();
  });

  it('reports adapter_unavailable instead of pretending to sync when no adapter exists', async () => {
    const harness = await connected({ adapter: null });

    expect(await harness.engine.run('manual')).toEqual({
      status: 'skipped',
      reason: 'adapter_unavailable',
    });
    expect((await harness.state.getSync()).lastSuccessAt).toBeUndefined();
    expect((await harness.state.getConnection())?.status).toBe('LOGIN_REQUIRED');
  });
});

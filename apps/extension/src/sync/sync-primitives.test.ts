import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../api/client.js';
import { createMemoryStore } from '../storage/key-value-store.js';
import { withSyncLock } from './lock.js';
import { OUTBOX_LIMITS, Outbox } from './outbox.js';
import { nextSyncDelayMinutes, retryDelayMinutes } from './schedule.js';

describe('schedule', () => {
  it('jitters the 30-minute interval by at most 3 minutes', () => {
    expect(nextSyncDelayMinutes(() => 0)).toBe(27);
    expect(nextSyncDelayMinutes(() => 0.5)).toBe(30);
    expect(nextSyncDelayMinutes(() => 0.999999)).toBeCloseTo(33, 3);
  });

  it('allows three retries within two hours, then gives up', () => {
    expect([1, 2, 3].map(retryDelayMinutes)).toEqual([5, 15, 45]);
    expect([5, 15, 45].reduce((a, b) => a + b)).toBeLessThanOrEqual(120);
    expect(retryDelayMinutes(4)).toBeNull();
  });
});

describe('withSyncLock', () => {
  it('lets only one of two concurrent runs execute', async () => {
    const store = createMemoryStore();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => (release = resolve));

    const first = withSyncLock(
      store,
      () => 0,
      () => blocker.then(() => 'first'),
    );
    const second = await withSyncLock(
      store,
      () => 0,
      () => Promise.resolve('second'),
    );
    release();

    expect(second).toEqual({ acquired: false });
    expect(await first).toEqual({ acquired: true, value: 'first' });
  });

  it('releases the lock after the run, even when it throws', async () => {
    const store = createMemoryStore();
    await expect(
      withSyncLock(
        store,
        () => 0,
        () => Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');

    expect(
      await withSyncLock(
        store,
        () => 0,
        () => Promise.resolve(1),
      ),
    ).toEqual({
      acquired: true,
      value: 1,
    });
  });

  it('ignores a lock left behind by a crashed run once it expires', async () => {
    const store = createMemoryStore({ syncLock: { runId: 'crashed', expiresAt: 1_000 } });

    expect(
      (
        await withSyncLock(
          store,
          () => 999,
          () => Promise.resolve(1),
        )
      ).acquired,
    ).toBe(false);
    expect(
      (
        await withSyncLock(
          store,
          () => 1_001,
          () => Promise.resolve(1),
        )
      ).acquired,
    ).toBe(true);
  });
});

describe('Outbox', () => {
  const probe = (connectionId: string, result: 'authenticated' | 'login_required') => ({
    kind: 'probe' as const,
    connectionId,
    report: { result },
  });

  it('keeps only the latest probe per connection', async () => {
    const outbox = new Outbox(createMemoryStore(), () => 0);
    await outbox.enqueue(probe('a', 'login_required'));
    await outbox.enqueue(probe('a', 'authenticated'));
    await outbox.enqueue(probe('b', 'authenticated'));

    const items = await outbox.list();
    expect(items.map((item) => item.payload)).toEqual([
      probe('a', 'authenticated'),
      probe('b', 'authenticated'),
    ]);
  });

  it('retries transient failures with backoff and drops permanent ones', async () => {
    let now = 0;
    const outbox = new Outbox(createMemoryStore(), () => now);
    await outbox.enqueue(probe('transient', 'authenticated'));
    await outbox.enqueue(probe('permanent', 'authenticated'));

    const result = await outbox.flush((payload) =>
      Promise.reject(
        payload.connectionId === 'transient'
          ? new ApiError(503, undefined)
          : new ApiError(404, undefined),
      ),
    );
    expect(result).toEqual({ sent: 0, dropped: 1, remaining: 1 });

    // Not due yet: nothing is attempted.
    const sent: string[] = [];
    await outbox.flush((payload) => {
      sent.push(payload.connectionId);
      return Promise.resolve();
    });
    expect(sent).toEqual([]);

    now += OUTBOX_LIMITS.backoffMs[0];
    expect(await outbox.flush(() => Promise.resolve())).toEqual({
      sent: 1,
      dropped: 0,
      remaining: 0,
    });
  });

  it('stops after the first network error and drops items past their attempt budget', async () => {
    let now = 0;
    const outbox = new Outbox(createMemoryStore(), () => now);
    await outbox.enqueue(probe('a', 'authenticated'));
    await outbox.enqueue(probe('b', 'authenticated'));

    let attempts = 0;
    const offline = () => {
      attempts += 1;
      return Promise.reject(new NetworkError('offline'));
    };
    await outbox.flush(offline);
    expect(attempts).toBe(1);

    // Each item gets its own attempt budget; 2 items x 5 attempts, well within 24 hours.
    for (let i = 0; i < OUTBOX_LIMITS.maxAttempts * 2 + 2; i += 1) {
      now += 60 * 60_000;
      await outbox.flush(offline);
    }
    expect(await outbox.list()).toEqual([]);
  });

  it('drops items older than 24 hours without sending them', async () => {
    let now = 0;
    const outbox = new Outbox(createMemoryStore(), () => now);
    await outbox.enqueue(probe('a', 'authenticated'));
    now = OUTBOX_LIMITS.maxAgeMs + 1;

    expect(await outbox.flush(() => Promise.reject(new Error('must not send')))).toEqual({
      sent: 0,
      dropped: 1,
      remaining: 0,
    });
  });
});

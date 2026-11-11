import { SYNC_POLICY } from '../config.js';
import type { KeyValueStore } from '../storage/key-value-store.js';
import { STATE_KEYS } from '../storage/extension-state.js';

interface StoredLock {
  readonly runId: string;
  readonly expiresAt: number;
}

/** Serializes lock acquisition inside one service worker (storage reads are not atomic). */
let acquisition: Promise<unknown> = Promise.resolve();

/**
 * Runs `task` only if no other sync run holds the per-device lock. The lock lives in storage
 * so it survives service-worker restarts, and expires so that a crashed run cannot block
 * syncing forever.
 */
export async function withSyncLock<T>(
  store: KeyValueStore,
  now: () => number,
  task: (runId: string) => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const runId = crypto.randomUUID();
  const acquire = acquisition.then(async () => {
    const current = await store.get<StoredLock>(STATE_KEYS.lock);
    if (current && current.expiresAt > now()) {
      return false;
    }
    await store.set(STATE_KEYS.lock, { runId, expiresAt: now() + SYNC_POLICY.lockTtlMs });
    return true;
  });
  acquisition = acquire.catch(() => undefined);
  if (!(await acquire)) {
    return { acquired: false };
  }
  try {
    return { acquired: true, value: await task(runId) };
  } finally {
    const current = await store.get<StoredLock>(STATE_KEYS.lock);
    if (current?.runId === runId) {
      await store.remove(STATE_KEYS.lock);
    }
  }
}

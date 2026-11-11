import { SYNC_POLICY } from '../config.js';

/** Schedules the next automatic sync (a one-shot `chrome.alarms` alarm in production). */
export interface SyncScheduler {
  schedule(delayMinutes: number): Promise<void>;
  clear(): Promise<void>;
}

/** Nominal interval plus uniform jitter in [-jitter, +jitter] minutes. */
export function nextSyncDelayMinutes(random: () => number = Math.random): number {
  const jitter = (random() * 2 - 1) * SYNC_POLICY.jitterMinutes;
  return SYNC_POLICY.intervalMinutes + jitter;
}

/**
 * Delay before retrying after `consecutiveFailures` failures, or `null` once the retry
 * budget (3 retries within about 2 hours) is spent and the normal interval should resume.
 */
export function retryDelayMinutes(consecutiveFailures: number): number | null {
  return SYNC_POLICY.retryDelaysMinutes[consecutiveFailures - 1] ?? null;
}

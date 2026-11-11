import type { ProbeReportRequest } from '@campuswatch/contracts';
import { ApiError, NetworkError } from '../api/client.js';
import type { KeyValueStore } from '../storage/key-value-store.js';
import { STATE_KEYS } from '../storage/extension-state.js';

/** Requests that failed transiently and are retried on later sync runs. */
export type OutboxPayload = {
  readonly kind: 'probe';
  readonly connectionId: string;
  readonly report: ProbeReportRequest;
};

export interface OutboxItem {
  readonly id: string;
  /** Items with the same key replace each other: only the latest probe matters. */
  readonly dedupeKey: string;
  readonly payload: OutboxPayload;
  readonly attempts: number;
  readonly createdAt: number;
  readonly nextAttemptAt: number;
}

export const OUTBOX_LIMITS = {
  maxItems: 20,
  maxAttempts: 5,
  maxAgeMs: 24 * 60 * 60 * 1000,
  backoffMs: [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000],
} as const;

export interface FlushResult {
  readonly sent: number;
  readonly dropped: number;
  readonly remaining: number;
}

export function isTransientError(error: unknown): boolean {
  return error instanceof NetworkError || (error instanceof ApiError && error.transient);
}

export class Outbox {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number,
  ) {}

  async list(): Promise<OutboxItem[]> {
    return (await this.store.get<OutboxItem[]>(STATE_KEYS.outbox)) ?? [];
  }

  async enqueue(payload: OutboxPayload): Promise<void> {
    const dedupeKey = `${payload.kind}:${payload.connectionId}`;
    const items = (await this.list()).filter((item) => item.dedupeKey !== dedupeKey);
    items.push({
      id: crypto.randomUUID(),
      dedupeKey,
      payload,
      attempts: 0,
      createdAt: this.now(),
      nextAttemptAt: this.now(),
    });
    await this.save(items.slice(-OUTBOX_LIMITS.maxItems));
  }

  /**
   * Sends due items in order. Transient failures are retried with backoff; permanent
   * failures (4xx) and items past their attempt or age budget are dropped.
   */
  async flush(send: (payload: OutboxPayload) => Promise<void>): Promise<FlushResult> {
    let sent = 0;
    let dropped = 0;
    const remaining: OutboxItem[] = [];
    let offline = false;

    for (const item of await this.list()) {
      if (this.now() - item.createdAt > OUTBOX_LIMITS.maxAgeMs) {
        dropped += 1;
        continue;
      }
      if (offline || item.nextAttemptAt > this.now()) {
        remaining.push(item);
        continue;
      }
      try {
        await send(item.payload);
        sent += 1;
      } catch (error) {
        const attempts = item.attempts + 1;
        if (!isTransientError(error) || attempts >= OUTBOX_LIMITS.maxAttempts) {
          dropped += 1;
          continue;
        }
        offline = error instanceof NetworkError;
        const delay = OUTBOX_LIMITS.backoffMs[attempts - 1] ?? OUTBOX_LIMITS.backoffMs.at(-1)!;
        remaining.push({ ...item, attempts, nextAttemptAt: this.now() + delay });
      }
    }

    await this.save(remaining);
    return { sent, dropped, remaining: remaining.length };
  }

  private async save(items: OutboxItem[]): Promise<void> {
    if (items.length === 0) {
      await this.store.remove(STATE_KEYS.outbox);
    } else {
      await this.store.set(STATE_KEYS.outbox, items);
    }
  }
}

import type { ProbeReportRequest } from '@campuswatch/contracts';
import type { AdapterErrorCode, PortalAdapter, SessionProbeResult } from '@campuswatch/portal-core';
import { ApiError, type CampusWatchApi } from '../api/client.js';
import { SYNC_POLICY } from '../config.js';
import {
  type ExtensionState,
  STATE_KEYS,
  type StoredConnection,
  type SyncResult,
} from '../storage/extension-state.js';
import { withSyncLock } from './lock.js';
import { isTransientError, type Outbox, type OutboxPayload } from './outbox.js';
import { nextSyncDelayMinutes, retryDelayMinutes, type SyncScheduler } from './schedule.js';

export type SyncTrigger = 'alarm' | 'manual' | 'startup' | 'portal-login' | 'connect' | 'resume';

export type SyncOutcome =
  | {
      readonly status: 'skipped';
      readonly reason:
        'signed_out' | 'no_connection' | 'paused' | 'polling_stopped' | 'adapter_unavailable';
    }
  | { readonly status: 'busy' }
  | { readonly status: 'cooldown'; readonly availableAt: string }
  | { readonly status: 'completed'; readonly result: SyncResult };

export interface SyncEngineDeps {
  readonly state: ExtensionState;
  readonly api: CampusWatchApi;
  readonly outbox: Outbox;
  readonly scheduler: SyncScheduler;
  /** `null` when this build has no Portal adapter for the connection. */
  readonly adapter: PortalAdapter | null;
  readonly now: () => Date;
  readonly random?: () => number;
}

const PROBE_RESULT: Record<SessionProbeResult['state'], ProbeReportRequest['result']> = {
  authenticated: 'authenticated',
  login_required: 'login_required',
  unavailable: 'unavailable',
};

const ADAPTER_ERROR_RESULT: Record<AdapterErrorCode, SyncResult> = {
  LOGIN_REQUIRED: 'login_required',
  PORTAL_UNAVAILABLE: 'portal_unavailable',
  ADAPTER_NEEDS_UPDATE: 'adapter_needs_update',
  NETWORK_ERROR: 'network_error',
};

/**
 * One sync run: flush queued requests, probe the Portal session, report it, and schedule
 * the next run. Never reports success unless the Portal was actually read.
 */
export class SyncEngine {
  constructor(private readonly deps: SyncEngineDeps) {}

  async run(trigger: SyncTrigger): Promise<SyncOutcome> {
    const { state, scheduler } = this.deps;
    const now = this.deps.now();
    const sync = await state.getSync();

    if (trigger === 'manual' && sync.lastManualSyncAt) {
      const availableAt = Date.parse(sync.lastManualSyncAt) + SYNC_POLICY.manualCooldownMs;
      if (availableAt > now.getTime()) {
        return { status: 'cooldown', availableAt: new Date(availableAt).toISOString() };
      }
    }

    const [session, device, connection] = await Promise.all([
      state.getSession(),
      state.getDevice(),
      state.getConnection(),
    ]);
    if (!session || !device) {
      await scheduler.clear();
      return { status: 'skipped', reason: 'signed_out' };
    }
    if (!connection) {
      await scheduler.clear();
      return { status: 'skipped', reason: 'no_connection' };
    }
    if (connection.status === 'PAUSED') {
      await scheduler.clear();
      return { status: 'skipped', reason: 'paused' };
    }
    if (trigger === 'alarm' && sync.polling === 'stopped') {
      return { status: 'skipped', reason: 'polling_stopped' };
    }
    if (this.deps.adapter?.capabilities().implementationStatus !== 'implemented') {
      await state.updateSync({
        lastResult: 'adapter_unavailable',
        lastAttemptAt: now.toISOString(),
      });
      await scheduler.clear();
      return { status: 'skipped', reason: 'adapter_unavailable' };
    }

    const adapter = this.deps.adapter;
    const lock = await withSyncLock(
      state.store,
      () => this.deps.now().getTime(),
      () => this.execute(trigger, connection, adapter),
    );
    return lock.acquired ? { status: 'completed', result: lock.value } : { status: 'busy' };
  }

  private async execute(
    trigger: SyncTrigger,
    connection: StoredConnection,
    adapter: PortalAdapter,
  ): Promise<SyncResult> {
    const startedAt = this.deps.now().toISOString();
    await this.deps.state.updateSync({
      lastAttemptAt: startedAt,
      ...(trigger === 'manual' ? { lastManualSyncAt: startedAt } : {}),
    });
    await this.deps.outbox.flush((payload) => this.send(payload));

    let result: SyncResult;
    try {
      const signal = AbortSignal.timeout(SYNC_POLICY.portalTimeoutMs);
      const probe = await adapter.probeSession({ signal });
      await this.sendOrQueue({
        kind: 'probe',
        connectionId: connection.id,
        report: { result: PROBE_RESULT[probe.state] },
      });
      result =
        probe.state === 'authenticated'
          ? 'ok'
          : probe.state === 'login_required'
            ? 'login_required'
            : 'portal_unavailable';
    } catch (error) {
      result = this.classify(error, adapter);
    } finally {
      await adapter.dispose?.().catch(() => undefined);
    }
    await this.finish(result);
    return result;
  }

  private async send(payload: OutboxPayload): Promise<void> {
    const updated = await this.deps.api.reportProbe(payload.connectionId, payload.report);
    const stored = await this.deps.state.getConnection();
    if (stored?.id === updated.id) {
      await this.deps.state.setConnection({
        ...stored,
        status: updated.status,
        lastSyncAt: updated.lastSyncAt,
      });
    }
  }

  /** Sends now; a transient failure queues the request for the next run and is rethrown. */
  private async sendOrQueue(payload: OutboxPayload): Promise<void> {
    try {
      await this.send(payload);
    } catch (error) {
      if (isTransientError(error)) {
        await this.deps.outbox.enqueue(payload);
      }
      throw error;
    }
  }

  private classify(error: unknown, adapter: PortalAdapter): SyncResult {
    if (error instanceof ApiError && error.status === 401) {
      return 'device_revoked';
    }
    if (isTransientError(error)) {
      return 'network_error';
    }
    if (error instanceof ApiError) {
      return 'network_error';
    }
    return ADAPTER_ERROR_RESULT[adapter.classifyError(error)];
  }

  private async finish(result: SyncResult): Promise<void> {
    const { state, scheduler } = this.deps;
    const now = this.deps.now();
    const random = this.deps.random ?? Math.random;
    const scheduleIn = async (minutes: number) => {
      await scheduler.schedule(minutes);
      return new Date(now.getTime() + minutes * 60_000).toISOString();
    };

    switch (result) {
      case 'ok': {
        const nextRunAt = await scheduleIn(nextSyncDelayMinutes(random));
        await state.updateSync({
          lastResult: result,
          lastSuccessAt: now.toISOString(),
          consecutiveFailures: 0,
          polling: 'active',
          nextRunAt,
        });
        return;
      }
      case 'login_required':
      case 'device_revoked': {
        // Stop polling: retrying cannot help until the user acts (plan section 6.3).
        await scheduler.clear();
        if (result === 'device_revoked') {
          await state.store.remove(STATE_KEYS.device);
        }
        await state.updateSync({
          lastResult: result,
          consecutiveFailures: 0,
          polling: 'stopped',
          nextRunAt: undefined,
        });
        return;
      }
      case 'adapter_needs_update': {
        // Parser drift does not fix itself within minutes: keep the normal cadence.
        const nextRunAt = await scheduleIn(nextSyncDelayMinutes(random));
        await state.updateSync({ lastResult: result, nextRunAt });
        return;
      }
      default: {
        const failures = (await state.getSync()).consecutiveFailures + 1;
        const retry = retryDelayMinutes(failures);
        const nextRunAt = await scheduleIn(retry ?? nextSyncDelayMinutes(random));
        await state.updateSync({
          lastResult: result,
          consecutiveFailures: retry === null ? 0 : failures,
          polling: 'active',
          nextRunAt,
        });
      }
    }
  }
}

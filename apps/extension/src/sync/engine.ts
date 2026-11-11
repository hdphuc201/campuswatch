import {
  PORTAL_DATA_SOURCES,
  type PortalDataSource,
  type ProbeReportRequest,
  type RenderedNotification,
  type SourceSnapshot,
} from '@campuswatch/contracts';
import type {
  AdapterErrorCode,
  CollectContext,
  CollectResult,
  PortalAdapter,
  SessionProbeResult,
} from '@campuswatch/portal-core';
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
  /** Shows a Chrome notification; omitted in contexts without the notifications API. */
  readonly notifier?: Notifier;
}

export interface Notifier {
  show(notification: RenderedNotification): Promise<void>;
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

/** Error details sent to the API: page and field names only, in a strict character set. */
function safeDetail(error: unknown): string {
  const detail = (error as { detail?: unknown } | null)?.detail;
  return typeof detail === 'string' && /^[\w .,:;()/#-]{1,200}$/.test(detail)
    ? detail
    : 'collector error';
}

/** Overall local result of a run that read the Portal. */
function resultFromSources(sources: SourceSnapshot[]): SyncResult {
  const codes = sources.flatMap((source) => (source.status === 'error' ? [source.errorCode] : []));
  if (codes.includes('LOGIN_REQUIRED')) {
    return 'login_required';
  }
  if (codes.includes('ADAPTER_NEEDS_UPDATE')) {
    return 'adapter_needs_update';
  }
  if (codes.length === sources.length) {
    return codes[0] === 'NETWORK_ERROR' ? 'network_error' : 'portal_unavailable';
  }
  return 'ok';
}

/**
 * One sync run: flush queued requests, probe the Portal session, collect every source,
 * upload one snapshot (or report the probe), and schedule the next run. Never reports success unless the Portal was actually read.
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
      if (probe.state === 'authenticated') {
        // A snapshot upload also updates the connection status on the server.
        const sources = await this.collectAll(adapter, signal);
        await this.sendOrQueue({
          kind: 'snapshot',
          connectionId: connection.id,
          snapshot: {
            connectionId: connection.id,
            syncRunId: crypto.randomUUID(),
            collectedAt: this.deps.now().toISOString(),
            sources,
          },
        });
        result = resultFromSources(sources);
      } else {
        await this.sendOrQueue({
          kind: 'probe',
          connectionId: connection.id,
          report: { result: PROBE_RESULT[probe.state] },
        });
        result = probe.state === 'login_required' ? 'login_required' : 'portal_unavailable';
      }
    } catch (error) {
      result = this.classify(error, adapter);
    } finally {
      await adapter.dispose?.().catch(() => undefined);
    }
    await this.finish(result);
    if (result !== 'device_revoked') {
      await this.deliverNotifications();
    }
    return result;
  }

  /**
   * Shows due Chrome notifications for this user (one notification per batch) and
   * acknowledges them. Best effort: failures leave them claimable on a later run.
   */
  private async deliverNotifications(): Promise<void> {
    const notifier = this.deps.notifier;
    if (!notifier) {
      return;
    }
    try {
      const batch = await this.deps.api.pendingNotifications();
      if (batch.notification && batch.deliveryIds.length > 0) {
        await notifier.show(batch.notification);
        await this.deps.api.ackNotifications(batch.deliveryIds);
      }
    } catch {
      // Unacknowledged deliveries become available again after their claim expires.
    }
  }

  /** Collects every source; one failing source does not stop the others. */
  private async collectAll(adapter: PortalAdapter, signal: AbortSignal): Promise<SourceSnapshot[]> {
    const collectors: Record<
      PortalDataSource,
      (context: CollectContext) => Promise<CollectResult>
    > = {
      grades: (context) => adapter.collectGrades(context),
      tuition: (context) => adapter.collectTuition(context),
      timetable: (context) => adapter.collectTimetable(context),
      exams: (context) => adapter.collectExams(context),
      dashboardNotices: (context) => adapter.collectDashboardNotices(context),
    };
    const sources: SourceSnapshot[] = [];
    for (const source of PORTAL_DATA_SOURCES) {
      try {
        const { entities } = await collectors[source]({ signal });
        sources.push({ source, status: 'ok', entities: [...entities] });
      } catch (error) {
        const errorCode = adapter.classifyError(error);
        sources.push({ source, status: 'error', errorCode, errorDetail: safeDetail(error) });
        if (errorCode === 'LOGIN_REQUIRED') {
          // The session ended mid-run: reading further pages cannot succeed.
          break;
        }
      }
    }
    return sources;
  }

  private async send(payload: OutboxPayload): Promise<void> {
    const updated =
      payload.kind === 'snapshot'
        ? (await this.deps.api.uploadSnapshot(payload.snapshot)).connection
        : await this.deps.api.reportProbe(payload.connectionId, payload.report);
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

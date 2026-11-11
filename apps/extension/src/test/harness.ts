import type {
  NormalizedEntity,
  PortalDataSource,
  RenderedNotification,
} from '@campuswatch/contracts';
import type {
  AdapterCapabilities,
  CollectResult,
  PortalAdapter,
  SessionProbeResult,
} from '@campuswatch/portal-core';
import { citdCapabilities } from '@campuswatch/portal-core';
import { CampusWatchApi } from '../api/client.js';
import { ExtensionController } from '../background/controller.js';
import { ExtensionState } from '../storage/extension-state.js';
import { createMemoryStore } from '../storage/key-value-store.js';
import { SyncEngine } from '../sync/engine.js';
import { Outbox } from '../sync/outbox.js';
import type { SyncScheduler } from '../sync/schedule.js';
import { createFakeApi, type FakeApi } from './fake-api.js';

export class FakeAdapter implements PortalAdapter {
  probeState: SessionProbeResult['state'] = 'authenticated';
  probeError?: Error;
  probes = 0;
  entities: Partial<Record<PortalDataSource, NormalizedEntity[]>> = {};
  failures: Partial<Record<PortalDataSource, Error>> = {};

  capabilities(): AdapterCapabilities {
    return { ...citdCapabilities, implementationStatus: 'implemented' };
  }

  probeSession(): Promise<SessionProbeResult> {
    this.probes += 1;
    return this.probeError
      ? Promise.reject(this.probeError)
      : Promise.resolve({ state: this.probeState });
  }

  private collect(source: PortalDataSource): Promise<CollectResult> {
    const failure = this.failures[source];
    return failure
      ? Promise.reject(failure)
      : Promise.resolve({ source, entities: this.entities[source] ?? [] });
  }

  collectGrades = () => this.collect('grades');
  collectTuition = () => this.collect('tuition');
  collectTimetable = () => this.collect('timetable');
  collectExams = () => this.collect('exams');
  collectDashboardNotices = () => this.collect('dashboardNotices');

  classifyError(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'drift') {
      return 'ADAPTER_NEEDS_UPDATE' as const;
    }
    return message === 'login' ? ('LOGIN_REQUIRED' as const) : ('PORTAL_UNAVAILABLE' as const);
  }
}

export class RecordingScheduler implements SyncScheduler {
  scheduled: number[] = [];
  active: number | null = null;

  schedule(delayMinutes: number): Promise<void> {
    this.scheduled.push(delayMinutes);
    this.active = delayMinutes;
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.active = null;
    return Promise.resolve();
  }
}

/** Builds the real controller and engine on top of the fake API and in-memory storage. */
export function createHarness(options: { adapter?: PortalAdapter | null; backend?: FakeApi } = {}) {
  let now = new Date('2026-11-11T08:00:00.000Z');
  const clock = {
    now: () => now,
    advanceMinutes: (minutes: number) => {
      now = new Date(now.getTime() + minutes * 60_000);
    },
  };
  const backend = options.backend ?? createFakeApi();
  const store = createMemoryStore();
  const state = new ExtensionState(store);
  const api = new CampusWatchApi({ baseUrl: 'https://api.test', fetch: backend.fetch, state });
  const outbox = new Outbox(store, () => clock.now().getTime());
  const scheduler = new RecordingScheduler();
  const adapter = options.adapter === undefined ? new FakeAdapter() : options.adapter;
  const shown: RenderedNotification[] = [];
  const opened: string[] = [];
  const engine = new SyncEngine({
    state,
    api,
    outbox,
    scheduler,
    adapter,
    now: clock.now,
    random: () => 0.5,
    notifier: {
      show: (notification) => {
        shown.push(notification);
        return Promise.resolve();
      },
    },
  });
  const controller = new ExtensionController({
    state,
    api,
    engine,
    scheduler,
    extensionVersion: '0.1.0',
    adapterAvailable: adapter?.capabilities().implementationStatus === 'implemented',
    adapterBeta: false,
    now: clock.now,
    openUrl: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
  });
  return {
    backend,
    store,
    state,
    api,
    outbox,
    scheduler,
    adapter,
    engine,
    controller,
    clock,
    shown,
    opened,
  };
}

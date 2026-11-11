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

  capabilities(): AdapterCapabilities {
    return { ...citdCapabilities, implementationStatus: 'implemented' };
  }

  probeSession(): Promise<SessionProbeResult> {
    this.probes += 1;
    return this.probeError
      ? Promise.reject(this.probeError)
      : Promise.resolve({ state: this.probeState });
  }

  private empty(source: CollectResult['source']): Promise<CollectResult> {
    return Promise.resolve({ source, entities: [] });
  }

  collectGrades = () => this.empty('grades');
  collectTuition = () => this.empty('tuition');
  collectTimetable = () => this.empty('timetable');
  collectExams = () => this.empty('exams');
  collectDashboardNotices = () => this.empty('dashboardNotices');

  classifyError(error: unknown) {
    return error instanceof Error && error.message === 'drift'
      ? ('ADAPTER_NEEDS_UPDATE' as const)
      : ('PORTAL_UNAVAILABLE' as const);
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
  const engine = new SyncEngine({
    state,
    api,
    outbox,
    scheduler,
    adapter,
    now: clock.now,
    random: () => 0.5,
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
  });
  return { backend, store, state, api, outbox, scheduler, adapter, engine, controller, clock };
}

import type { PortalAdapter } from '@campuswatch/portal-core';
import { browser } from 'wxt/browser';
import { CampusWatchApi } from '../api/client.js';
import { API_BASE_URL } from '../config.js';
import { ExtensionState } from '../storage/extension-state.js';
import type { KeyValueStore } from '../storage/key-value-store.js';
import { SyncEngine } from '../sync/engine.js';
import { Outbox } from '../sync/outbox.js';
import type { SyncScheduler } from '../sync/schedule.js';
import type { Notifier } from '../sync/engine.js';
import { ExtensionController } from './controller.js';

export const SYNC_ALARM = 'campuswatch-sync';

function chromeStore(): KeyValueStore {
  const area = browser.storage.local;
  return {
    get: async <T>(key: string) => (await area.get(key))[key] as T | undefined,
    set: (key, value) => area.set({ [key]: value }),
    remove: (keys) => area.remove(keys),
    keys: async () => Object.keys(await area.get(null)),
  };
}

const alarmScheduler: SyncScheduler = {
  async schedule(delayMinutes) {
    // Chrome enforces a 30-second minimum for alarms.
    await browser.alarms.create(SYNC_ALARM, { delayInMinutes: Math.max(delayMinutes, 0.5) });
  },
  async clear() {
    await browser.alarms.clear(SYNC_ALARM);
  },
};

const chromeNotifier: Notifier = {
  async show(notification) {
    await browser.notifications.create(`campuswatch-${Date.now()}`, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: notification.title,
      message: notification.body,
      priority: 1,
    });
  },
};

/** Wires the controller to real Chrome APIs. Called once per service-worker start. */
export function createRuntime(adapter: PortalAdapter | null) {
  const state = new ExtensionState(chromeStore());
  const now = () => new Date();
  const api = new CampusWatchApi({ baseUrl: API_BASE_URL, fetch: fetch.bind(globalThis), state });
  const outbox = new Outbox(state.store, () => Date.now());
  const engine = new SyncEngine({
    state,
    api,
    outbox,
    scheduler: alarmScheduler,
    adapter,
    now,
    notifier: chromeNotifier,
  });
  const controller = new ExtensionController({
    state,
    api,
    engine,
    scheduler: alarmScheduler,
    extensionVersion: browser.runtime.getManifest().version,
    adapterAvailable: adapter?.capabilities().implementationStatus === 'implemented',
    adapterBeta: adapter?.capabilities().liveVerified === false,
    now,
    openUrl: async (url) => {
      await browser.tabs.create({ url });
    },
  });
  return { engine, controller };
}

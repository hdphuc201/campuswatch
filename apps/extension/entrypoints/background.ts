import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { getPortalAdapter } from '../src/adapters/registry.js';
import { createRuntime, SYNC_ALARM } from '../src/background/runtime.js';
import { PORTAL_ORIGIN } from '../src/config.js';
import { type CommandResult, isCommand } from '../src/messaging.js';

export default defineBackground({
  type: 'module',
  main() {
    const { engine, controller } = createRuntime(getPortalAdapter());

    // Listeners are registered synchronously so Chrome can wake the worker for them.
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === SYNC_ALARM) {
        void engine.run('alarm');
      }
    });

    browser.runtime.onStartup.addListener(() => void controller.onStartup());
    browser.runtime.onInstalled.addListener(() => void controller.onStartup());

    // Host permission for the Portal lets us see its URLs without the `tabs` permission.
    browser.tabs.onUpdated.addListener((_tabId, info, tab) => {
      if (info.status === 'complete' && tab.url?.startsWith(`${PORTAL_ORIGIN}/`)) {
        void controller.onPortalPageLoaded();
      }
    });

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Only our own extension pages may send commands.
      if (sender.id !== browser.runtime.id || sender.tab || !isCommand(message)) {
        return false;
      }
      void controller.handle(message).then((result: CommandResult) => sendResponse(result));
      return true;
    });
  },
});

import {
  CITD_ORIGIN,
  CITD_PAGE_PATHS,
  CollectorError,
  type CollectorRequest,
  type CollectorResponse,
} from '@campuswatch/citd-adapter';
import { browser } from 'wxt/browser';
import type { PortalTabDriver } from './citd-extension-adapter.js';

const COLLECTOR_FILE = '/citd-collector.js';
const TAB_LOAD_TIMEOUT_MS = 30_000;

function waitForComplete(tabId: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error('Portal tab did not load')),
      TAB_LOAD_TIMEOUT_MS,
    );
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === 'complete') {
        finish();
      }
    };
    const onAbort = () => finish(new Error('aborted'));
    function finish(error?: Error) {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      signal.removeEventListener('abort', onAbort);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }
    browser.tabs.onUpdated.addListener(onUpdated);
    signal.addEventListener('abort', onAbort);
    void browser.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        finish();
      }
    }, finish);
  });
}

/**
 * Runs the collector in a CITD Portal tab. It reuses a tab the student already has open;
 * otherwise it opens one in the background and closes it when the run ends. Requires the
 * `scripting` permission and host access to the Portal only.
 */
export function createChromeTabDriver(): PortalTabDriver {
  let openedTabId: number | undefined;

  async function acquireTab(signal: AbortSignal): Promise<number> {
    const open = await browser.tabs.query({ url: `${CITD_ORIGIN}/*`, status: 'complete' });
    const existing = open.find((tab) => tab.id !== undefined && !tab.discarded);
    if (existing?.id !== undefined) {
      return existing.id;
    }
    if (openedTabId === undefined) {
      const tab = await browser.tabs.create({
        url: `${CITD_ORIGIN}${CITD_PAGE_PATHS.dashboard}`,
        active: false,
      });
      openedTabId = tab.id;
    }
    if (openedTabId === undefined) {
      throw new Error('Could not open a Portal tab');
    }
    await waitForComplete(openedTabId, signal);
    return openedTabId;
  }

  return {
    async run(request: CollectorRequest, signal: AbortSignal): Promise<CollectorResponse> {
      try {
        const tabId = await acquireTab(signal);
        await browser.scripting.executeScript({ target: { tabId }, files: [COLLECTOR_FILE] });
        const [injection] = await browser.scripting.executeScript({
          target: { tabId },
          func: (input: CollectorRequest) =>
            (
              globalThis as unknown as {
                __campuswatchCitd?: (request: CollectorRequest) => Promise<CollectorResponse>;
              }
            ).__campuswatchCitd?.(input),
          args: [request],
        });
        return injection?.result as CollectorResponse;
      } catch (error) {
        if (error instanceof CollectorError) {
          throw error;
        }
        // Tab closed, navigated away, or not loadable: report it as an unavailable Portal.
        throw new CollectorError('PORTAL_UNAVAILABLE', 'portal tab unavailable');
      }
    },
    async release(): Promise<void> {
      if (openedTabId !== undefined) {
        const tabId = openedTabId;
        openedTabId = undefined;
        await browser.tabs.remove(tabId).catch(() => undefined);
      }
    },
  };
}

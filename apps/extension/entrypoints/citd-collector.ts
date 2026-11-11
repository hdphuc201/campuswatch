import { CITD_ORIGIN, type CollectorRequest, runCollector } from '@campuswatch/citd-adapter';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

/**
 * Injected into a CITD Portal tab by the background service worker (never declared as a
 * content script, so it runs only when the extension asks). It reads Portal pages with GET
 * requests in the student's own session and returns normalized entities only.
 */
export default defineUnlistedScript(() => {
  if (location.origin !== CITD_ORIGIN) {
    return;
  }
  const collect = (request: CollectorRequest) =>
    runCollector(request, {
      origin: location.origin,
      fetch: fetch.bind(globalThis),
      parseHtml: (html) => new DOMParser().parseFromString(html, 'text/html'),
    });
  Object.assign(globalThis, { __campuswatchCitd: collect });
});

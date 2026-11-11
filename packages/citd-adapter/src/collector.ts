import type { NormalizedEntity } from '@campuswatch/contracts';
import type {
  AdapterErrorCode,
  PortalDataSource,
  SessionProbeResult,
} from '@campuswatch/portal-core';
import { type DraftEntity, finalizeDrafts } from './draft.js';
import { CollectorError, drift } from './errors.js';
import { detectSession, isLoginPage, noticeDrafts, parseNoticeTexts } from './parsers/dashboard.js';
import { parseGrades } from './parsers/grades.js';
import { parseExams, parseTimetable } from './parsers/schedule.js';
import { parseTuition } from './parsers/tuition.js';
import { CITD_PAGE_PATHS } from './profile.js';

export type CollectorRequest =
  { readonly action: 'probe' } | { readonly action: 'collect'; readonly source: PortalDataSource };

export type CollectorResponse =
  | { readonly ok: true; readonly probe: SessionProbeResult['state'] }
  | { readonly ok: true; readonly entities: NormalizedEntity[] }
  | { readonly ok: false; readonly code: AdapterErrorCode; readonly detail: string };

export interface CollectorEnvironment {
  /** Origin of the Portal tab the collector runs in. */
  readonly origin: string;
  readonly fetch: typeof fetch;
  readonly parseHtml: (html: string) => Document;
  readonly timeoutMs?: number;
}

const PARSERS: Record<PortalDataSource, (doc: Document) => DraftEntity[] | Promise<DraftEntity[]>> =
  {
    grades: parseGrades,
    tuition: parseTuition,
    timetable: parseTimetable,
    exams: parseExams,
    dashboardNotices: (doc) => noticeDrafts(parseNoticeTexts(doc)),
  };

/**
 * Reads one Portal page. GET only, same origin only, using the session the student already
 * has in this tab. Never submits forms, never logs in, never sends data anywhere.
 */
async function loadPage(env: CollectorEnvironment, path: string): Promise<Document> {
  const url = new URL(path, env.origin);
  if (url.origin !== env.origin) {
    throw drift('collector: cross-origin path refused');
  }
  let response: Response;
  try {
    response = await env.fetch(url.toString(), {
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'follow',
      cache: 'no-store',
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(env.timeoutMs ?? 20_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new CollectorError('PORTAL_UNAVAILABLE', `timeout: ${path}`);
    }
    throw new CollectorError('NETWORK_ERROR', `request failed: ${path}`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new CollectorError('LOGIN_REQUIRED', `status ${response.status}: ${path}`);
  }
  if (response.status >= 500 || response.status === 429) {
    throw new CollectorError('PORTAL_UNAVAILABLE', `status ${response.status}: ${path}`);
  }
  if (!response.ok) {
    throw drift(`unexpected status ${response.status}: ${path}`);
  }
  const doc = env.parseHtml(await response.text());
  if (isLoginPage(doc, response.url || url.toString())) {
    throw new CollectorError('LOGIN_REQUIRED', `login page: ${path}`);
  }
  return doc;
}

function failure(error: unknown): CollectorResponse {
  if (error instanceof CollectorError) {
    return { ok: false, code: error.code, detail: error.detail };
  }
  // Unknown errors may carry page content in their message: report the category only.
  return { ok: false, code: 'ADAPTER_NEEDS_UPDATE', detail: 'unexpected parser error' };
}

export async function runCollector(
  request: CollectorRequest,
  env: CollectorEnvironment,
): Promise<CollectorResponse> {
  try {
    if (request.action === 'probe') {
      const url = new URL(CITD_PAGE_PATHS.dashboard, env.origin).toString();
      try {
        const doc = await loadPage(env, CITD_PAGE_PATHS.dashboard);
        return { ok: true, probe: detectSession(doc, url) };
      } catch (error) {
        if (error instanceof CollectorError && error.code === 'LOGIN_REQUIRED') {
          return { ok: true, probe: 'login_required' };
        }
        if (error instanceof CollectorError && error.code === 'PORTAL_UNAVAILABLE') {
          return { ok: true, probe: 'unavailable' };
        }
        throw error;
      }
    }
    const doc = await loadPage(env, CITD_PAGE_PATHS[request.source]);
    const drafts = await PARSERS[request.source](doc);
    return { ok: true, entities: await finalizeDrafts(drafts) };
  } catch (error) {
    return failure(error);
  }
}

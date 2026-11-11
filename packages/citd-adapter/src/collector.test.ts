import { normalizedEntitySchema } from '@campuswatch/contracts';
import { describe, expect, it } from 'vitest';
import { type CollectorEnvironment, runCollector } from './collector.js';
import { CITD_ORIGIN, CITD_PAGE_PATHS } from './profile.js';
import { fixtureHtml } from './test-support.js';

interface Page {
  status?: number;
  body?: string;
  redirectTo?: string;
  error?: Error;
}

function environment(pages: Record<string, Page>) {
  const requests: { url: string; method: string; credentials: string | undefined }[] = [];
  const env: CollectorEnvironment = {
    origin: CITD_ORIGIN,
    parseHtml: (source) => new DOMParser().parseFromString(source, 'text/html'),
    fetch: (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push({ url, method: init?.method ?? 'GET', credentials: init?.credentials });
      const page = pages[new URL(url).pathname];
      if (page?.error) {
        return Promise.reject(page.error);
      }
      const response = new Response(page?.body ?? '', { status: page?.status ?? 200 });
      Object.defineProperty(response, 'url', {
        value: page?.redirectTo ? `${CITD_ORIGIN}${page.redirectTo}` : url,
      });
      return Promise.resolve(response);
    },
  };
  return { env, requests };
}

describe('runCollector', () => {
  it('probes the session from the dashboard', async () => {
    const loggedIn = environment({ '/': { body: fixtureHtml('dashboard.html') } });
    expect(await runCollector({ action: 'probe' }, loggedIn.env)).toEqual({
      ok: true,
      probe: 'authenticated',
    });

    const redirected = environment({
      '/': { body: fixtureHtml('login.html'), redirectTo: '/Account/Login?ReturnUrl=%2F' },
    });
    expect(await runCollector({ action: 'probe' }, redirected.env)).toEqual({
      ok: true,
      probe: 'login_required',
    });

    const down = environment({ '/': { status: 503 } });
    expect(await runCollector({ action: 'probe' }, down.env)).toEqual({
      ok: true,
      probe: 'unavailable',
    });
  });

  it('returns validated, fingerprinted entities and uses only same-origin GET requests', async () => {
    const { env, requests } = environment({
      [CITD_PAGE_PATHS.grades]: { body: fixtureHtml('grades.html') },
    });

    const response = await runCollector({ action: 'collect', source: 'grades' }, env);

    expect(response.ok).toBe(true);
    const entities = 'entities' in response ? response.entities : [];
    // 4 courses + semester-1 summary + cumulative summary.
    expect(entities.length).toBe(6);
    for (const entity of entities) {
      expect(normalizedEntitySchema.parse(entity)).toEqual(entity);
    }
    expect(requests).toEqual([
      {
        url: `${CITD_ORIGIN}${CITD_PAGE_PATHS.grades}`,
        method: 'GET',
        credentials: 'same-origin',
      },
    ]);
  });

  it('collects every verified source from its page', async () => {
    const { env } = environment({
      [CITD_PAGE_PATHS.tuition]: { body: fixtureHtml('tuition.html') },
      [CITD_PAGE_PATHS.timetable]: { body: fixtureHtml('timetable.html') },
      [CITD_PAGE_PATHS.exams]: { body: fixtureHtml('exams.html') },
      [CITD_PAGE_PATHS.dashboardNotices]: { body: fixtureHtml('dashboard.html') },
    });
    const counts: Record<string, number> = {};
    for (const source of ['tuition', 'timetable', 'exams', 'dashboardNotices'] as const) {
      const response = await runCollector({ action: 'collect', source }, env);
      counts[source] = 'entities' in response ? response.entities.length : -1;
    }
    expect(counts).toEqual({ tuition: 5, timetable: 3, exams: 2, dashboardNotices: 1 });
  });

  it('classifies an expired session, an outage, a network failure, and drift', async () => {
    const path = CITD_PAGE_PATHS.grades;
    const cases: [Page, string][] = [
      [{ body: fixtureHtml('login.html'), redirectTo: '/Account/Login' }, 'LOGIN_REQUIRED'],
      [{ status: 403 }, 'LOGIN_REQUIRED'],
      [{ status: 502 }, 'PORTAL_UNAVAILABLE'],
      [{ error: new TypeError('Failed to fetch') }, 'NETWORK_ERROR'],
      [{ status: 404 }, 'ADAPTER_NEEDS_UPDATE'],
      [{ body: fixtureHtml('grades-missing-column.html') }, 'ADAPTER_NEEDS_UPDATE'],
    ];
    for (const [page, code] of cases) {
      const { env } = environment({ [path]: page });
      const response = await runCollector({ action: 'collect', source: 'grades' }, env);
      expect(response).toMatchObject({ ok: false, code });
    }
  });

  it('never returns raw page content in failures', async () => {
    const secretPage = `<p>Mã sinh viên 2051234567 password=hunter2 ${'x'.repeat(50)}</p>`;
    const { env } = environment({ [CITD_PAGE_PATHS.grades]: { body: secretPage } });

    const response = await runCollector({ action: 'collect', source: 'grades' }, env);

    expect(response).toEqual({
      ok: false,
      code: 'ADAPTER_NEEDS_UPDATE',
      detail: 'grades: table not found',
    });
    expect(JSON.stringify(response)).not.toMatch(/2051234567|hunter2/);
  });
});

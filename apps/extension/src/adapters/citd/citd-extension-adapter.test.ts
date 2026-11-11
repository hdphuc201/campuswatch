import type { CollectorRequest, CollectorResponse } from '@campuswatch/citd-adapter';
import { describe, expect, it } from 'vitest';
import { createHarness } from '../../test/harness.js';
import {
  CitdExtensionAdapter,
  MAX_ENTITIES_PER_SOURCE,
  type PortalTabDriver,
} from './citd-extension-adapter.js';

const ENTITY = {
  entityType: 'grade_course',
  externalKey: '2025-2026|1|CS101|',
  payload: { courseCode: 'CS101', totalScore: 7.9 },
  fingerprint: 'a'.repeat(64),
} as const;

class FakeDriver implements PortalTabDriver {
  requests: CollectorRequest[] = [];
  released = 0;

  constructor(private readonly respond: (request: CollectorRequest) => unknown) {}

  run(request: CollectorRequest): Promise<CollectorResponse> {
    this.requests.push(request);
    return Promise.resolve(this.respond(request) as CollectorResponse);
  }

  release(): Promise<void> {
    this.released += 1;
    return Promise.resolve();
  }
}

const context = { signal: new AbortController().signal };

describe('CitdExtensionAdapter', () => {
  it('maps probe and collect responses', async () => {
    const driver = new FakeDriver((request) =>
      request.action === 'probe'
        ? { ok: true, probe: 'authenticated' }
        : { ok: true, entities: [ENTITY] },
    );
    const adapter = new CitdExtensionAdapter(driver);

    expect(await adapter.probeSession(context)).toEqual({ state: 'authenticated' });
    expect(await adapter.collectGrades(context)).toEqual({ source: 'grades', entities: [ENTITY] });
    expect(driver.requests).toEqual([{ action: 'probe' }, { action: 'collect', source: 'grades' }]);
  });

  it('rejects entities the page could have tampered with', async () => {
    const cases = [
      { ok: true, entities: [{ ...ENTITY, rawHtml: '<table>' }] },
      { ok: true, entities: [{ ...ENTITY, payload: { nested: { html: '<b>' } } }] },
      { ok: true, entities: Array.from({ length: MAX_ENTITIES_PER_SOURCE + 1 }, () => ENTITY) },
      { ok: true, entities: 'not an array' },
      undefined,
    ];
    for (const response of cases) {
      const adapter = new CitdExtensionAdapter(new FakeDriver(() => response));
      const error = await adapter.collectGrades(context).catch((caught: unknown) => caught);
      expect(adapter.classifyError(error)).toBe('ADAPTER_NEEDS_UPDATE');
    }
  });

  it('turns collector failures into adapter error codes', async () => {
    for (const code of ['LOGIN_REQUIRED', 'PORTAL_UNAVAILABLE', 'NETWORK_ERROR'] as const) {
      const adapter = new CitdExtensionAdapter(
        new FakeDriver(() => ({ ok: false, code, detail: 'grades page' })),
      );
      const error = await adapter.collectTuition(context).catch((caught: unknown) => caught);
      expect(adapter.classifyError(error)).toBe(code);
    }
    const adapter = new CitdExtensionAdapter(new FakeDriver(() => ({ ok: true })));
    expect(adapter.classifyError(new DOMException('slow', 'TimeoutError'))).toBe(
      'PORTAL_UNAVAILABLE',
    );
  });

  it('is released after every sync run, including failed ones', async () => {
    const driver = new FakeDriver(() => ({ ok: false, code: 'PORTAL_UNAVAILABLE', detail: 'x' }));
    const adapter = new CitdExtensionAdapter(driver);
    const harness = createHarness({ adapter });
    await harness.controller.handle({
      type: 'register',
      email: 'tab@example.edu',
      password: 'a long enough password',
    });
    await harness.controller.handle({ type: 'connect' });

    expect(driver.released).toBe(1);
    expect((await harness.state.getSync()).lastResult).toBe('portal_unavailable');
  });
});

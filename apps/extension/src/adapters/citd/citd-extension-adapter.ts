import {
  CollectorError,
  type CollectorRequest,
  type CollectorResponse,
  drift,
} from '@campuswatch/citd-adapter';
import { normalizedEntitySchema } from '@campuswatch/contracts';
import {
  type AdapterErrorCode,
  citdCapabilities,
  type CollectContext,
  type CollectResult,
  type PortalAdapter,
  type PortalDataSource,
  type SessionProbeResult,
} from '@campuswatch/portal-core';

/** Upper bound on entities per source; a real student has a few hundred at most. */
export const MAX_ENTITIES_PER_SOURCE = 5000;

/** Runs collector requests inside a CITD Portal tab. */
export interface PortalTabDriver {
  run(request: CollectorRequest, signal: AbortSignal): Promise<CollectorResponse>;
  /** Closes the tab the driver opened for this run, if any. */
  release(): Promise<void>;
}

/** The CITD adapter as used by the extension: collectors run in the Portal tab. */
export class CitdExtensionAdapter implements PortalAdapter {
  constructor(private readonly driver: PortalTabDriver) {}

  capabilities() {
    return citdCapabilities;
  }

  async probeSession(context: CollectContext): Promise<SessionProbeResult> {
    const response = await this.call({ action: 'probe' }, context.signal);
    if (!('probe' in response)) {
      throw drift('probe: unexpected response');
    }
    return { state: response.probe };
  }

  collectGrades = (context: CollectContext) => this.collect('grades', context);
  collectTuition = (context: CollectContext) => this.collect('tuition', context);
  collectTimetable = (context: CollectContext) => this.collect('timetable', context);
  collectExams = (context: CollectContext) => this.collect('exams', context);
  collectDashboardNotices = (context: CollectContext) => this.collect('dashboardNotices', context);

  classifyError(error: unknown): AdapterErrorCode {
    if (error instanceof CollectorError) {
      return error.code;
    }
    if (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name)) {
      return 'PORTAL_UNAVAILABLE';
    }
    return 'ADAPTER_NEEDS_UPDATE';
  }

  dispose(): Promise<void> {
    return this.driver.release();
  }

  private async call(request: CollectorRequest, signal: AbortSignal) {
    const response = await this.driver.run(request, signal);
    if (typeof response !== 'object' || response === null || !('ok' in response)) {
      throw drift('collector: no response');
    }
    if (!response.ok) {
      throw new CollectorError(response.code, response.detail);
    }
    return response;
  }

  private async collect(source: PortalDataSource, context: CollectContext): Promise<CollectResult> {
    const response = await this.call({ action: 'collect', source }, context.signal);
    if (!('entities' in response) || !Array.isArray(response.entities)) {
      throw drift(`${source}: unexpected response`);
    }
    if (response.entities.length > MAX_ENTITIES_PER_SOURCE) {
      throw drift(`${source}: too many entities`);
    }
    // The page controls the data the collector read, so validate before trusting it.
    const entities = response.entities.map((entity) => {
      const parsed = normalizedEntitySchema.safeParse(entity);
      if (!parsed.success) {
        throw drift(`${source}: invalid entity`);
      }
      return parsed.data;
    });
    return { source, entities };
  }
}

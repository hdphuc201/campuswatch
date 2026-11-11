import type { AdapterErrorCode } from '@campuswatch/portal-core';

/**
 * A classified collection failure. `detail` names pages and fields only, never Portal
 * values, so it is safe to log and to send to the API.
 */
export class CollectorError extends Error {
  override readonly name = 'CollectorError';

  constructor(
    readonly code: AdapterErrorCode,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
  }
}

/** The Portal layout no longer matches what the parsers expect (selector/schema drift). */
export function drift(detail: string): CollectorError {
  return new CollectorError('ADAPTER_NEEDS_UPDATE', detail);
}

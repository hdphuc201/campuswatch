import type { PortalAdapter } from '@campuswatch/portal-core';

/**
 * Portal adapter used by this build, or `null` when none is available. The CITD collectors
 * are added in phase P4; until then the extension reports that Portal reading is unavailable
 * instead of pretending to sync.
 */
export function getPortalAdapter(): PortalAdapter | null {
  return null;
}

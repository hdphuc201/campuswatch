import type { PortalAdapter } from '@campuswatch/portal-core';
import { CitdExtensionAdapter } from './citd/citd-extension-adapter.js';
import { createChromeTabDriver } from './citd/chrome-tab-driver.js';

/** The Portal adapter used by this build. Only CITD is supported (plan section 16). */
export function getPortalAdapter(): PortalAdapter {
  return new CitdExtensionAdapter(createChromeTabDriver());
}

import type { AdapterCapabilities } from './adapter.js';

/**
 * Capability declaration for the CITD Portal adapter (`@campuswatch/citd-adapter`).
 * Collectors exist for every verified source, but they are built from synthetic fixtures:
 * `liveVerified` stays false until a read-only check against the live Portal.
 */
export const citdCapabilities: AdapterCapabilities = Object.freeze({
  adapterKey: 'citd',
  displayName: 'CITD Portal',
  implementationStatus: 'implemented',
  readOnly: true,
  liveVerified: false,
  sources: Object.freeze({
    grades: 'supported',
    tuition: 'supported',
    timetable: 'supported',
    exams: 'supported',
    dashboardNotices: 'supported',
  }),
});

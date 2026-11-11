import type { AdapterCapabilities } from './adapter.js';

/**
 * Capability declaration for the CITD Portal adapter. No collector exists yet:
 * collectors are built in phase P4, one source at a time, from redacted fixtures.
 */
export const citdCapabilities: AdapterCapabilities = Object.freeze({
  adapterKey: 'citd',
  displayName: 'CITD Portal',
  implementationStatus: 'unimplemented',
  readOnly: true,
  sources: Object.freeze({
    grades: 'planned',
    tuition: 'planned',
    timetable: 'planned',
    exams: 'planned',
    dashboardNotices: 'planned',
  }),
});

/** Build-time configuration. Only public values belong here: never put secrets in the bundle. */
export const API_BASE_URL: string =
  (import.meta.env.WXT_API_BASE_URL as string | undefined) ?? 'http://127.0.0.1:3000';

export const PORTAL_ORIGIN = 'https://portal.citd.edu.vn';

/** Version of the consent text in `ConsentView`. Bump it whenever that text changes. */
export const CONSENT_VERSION = '2026-11';

export const SYNC_POLICY = {
  /** Nominal interval between automatic syncs (implementation plan, section 6.3). */
  intervalMinutes: 30,
  /** Random spread so that students do not all hit the Portal at the same moment. */
  jitterMinutes: 3,
  /** Retry delays after consecutive failures; afterwards the normal interval resumes. */
  retryDelaysMinutes: [5, 15, 45],
  /** Minimum time between manual "Sync now" requests. */
  manualCooldownMs: 5 * 60 * 1000,
  /** A crashed run releases its lock after this long. */
  lockTtlMs: 5 * 60 * 1000,
  /** Abort a Portal read that takes longer than this. */
  portalTimeoutMs: 60 * 1000,
} as const;

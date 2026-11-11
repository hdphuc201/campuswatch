import type {
  ConnectionHealthState,
  NormalizedEntity,
  PortalDataSource,
} from '@campuswatch/contracts';

export { PORTAL_DATA_SOURCES, type PortalDataSource } from '@campuswatch/contracts';

export type SourceSupport = 'supported' | 'planned' | 'unsupported';

export interface AdapterCapabilities {
  /** Stable adapter identifier, e.g. `citd`. */
  readonly adapterKey: string;
  readonly displayName: string;
  readonly implementationStatus: 'implemented' | 'unimplemented';
  /** Adapters only read data. A write-capable adapter is not allowed. */
  readonly readOnly: true;
  readonly sources: Readonly<Record<PortalDataSource, SourceSupport>>;
  /**
   * False while the collectors are only tested against synthetic fixtures. The UI labels such
   * adapters as beta; flip it only after a read-only check against the live Portal.
   */
  readonly liveVerified: boolean;
}

export type SessionProbeResult =
  | { readonly state: 'authenticated' }
  | { readonly state: 'login_required' }
  | { readonly state: 'unavailable' };

/** Error categories an adapter maps failures to; a subset of the user-facing health states. */
export type AdapterErrorCode = Extract<
  ConnectionHealthState,
  'LOGIN_REQUIRED' | 'PORTAL_UNAVAILABLE' | 'ADAPTER_NEEDS_UPDATE' | 'NETWORK_ERROR'
>;

export interface CollectContext {
  /** Aborts collection, e.g. on timeout or when the user pauses monitoring. */
  readonly signal: AbortSignal;
}

export interface CollectResult {
  readonly source: PortalDataSource;
  /** Normalized entities only: never raw HTML, cookies, tokens, or credentials. */
  readonly entities: readonly NormalizedEntity[];
}

/**
 * Read-only contract every Portal adapter implements. Collectors run inside the
 * student's own logged-in browser session and return normalized data only.
 *
 * There are deliberately no methods that log in, submit forms, or change Portal data.
 * Canonicalization and fingerprinting are shared (see `fingerprint.ts`), not per adapter.
 */
export interface PortalAdapter {
  capabilities(): AdapterCapabilities;
  probeSession(context: CollectContext): Promise<SessionProbeResult>;
  collectGrades(context: CollectContext): Promise<CollectResult>;
  collectTuition(context: CollectContext): Promise<CollectResult>;
  collectTimetable(context: CollectContext): Promise<CollectResult>;
  collectExams(context: CollectContext): Promise<CollectResult>;
  collectDashboardNotices(context: CollectContext): Promise<CollectResult>;
  classifyError(error: unknown): AdapterErrorCode;
  /** Releases per-run resources (for example a Portal tab the adapter opened). */
  dispose?(): Promise<void>;
}

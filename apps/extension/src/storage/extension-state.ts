import type { ConnectionHealthState } from '@campuswatch/contracts';
import type { KeyValueStore } from './key-value-store.js';

/**
 * Everything the extension persists. Only CampusWatch credentials and sync bookkeeping:
 * never a Portal password, cookie, CSRF token, or page HTML.
 */
export interface StoredSession {
  readonly email: string;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
}

export interface StoredDevice {
  readonly id: string;
  readonly token: string;
}

export interface StoredConnection {
  readonly id: string;
  readonly status: ConnectionHealthState;
  readonly consentVersion: string;
  readonly lastSyncAt: string | null;
}

/** Local result of the last sync attempt; the server status is in `StoredConnection`. */
export type SyncResult =
  | 'ok'
  | 'login_required'
  | 'portal_unavailable'
  | 'network_error'
  | 'adapter_needs_update'
  | 'adapter_unavailable'
  | 'device_revoked';

export interface SyncState {
  readonly lastAttemptAt?: string;
  readonly lastSuccessAt?: string;
  readonly lastResult?: SyncResult;
  readonly consecutiveFailures: number;
  readonly nextRunAt?: string;
  /** `stopped` after LOGIN_REQUIRED: polling resumes only after a new Portal login or user action. */
  readonly polling: 'active' | 'stopped';
  readonly lastManualSyncAt?: string;
}

export const STATE_KEYS = {
  session: 'session',
  device: 'device',
  connection: 'connection',
  sync: 'sync',
  outbox: 'outbox',
  lock: 'syncLock',
} as const;

/** Keys the extension is allowed to persist. Tests assert nothing else is ever written. */
export const ALLOWED_STATE_KEYS: readonly string[] = Object.values(STATE_KEYS);

export const INITIAL_SYNC_STATE: SyncState = { consecutiveFailures: 0, polling: 'active' };

export class ExtensionState {
  constructor(readonly store: KeyValueStore) {}

  getSession = () => this.store.get<StoredSession>(STATE_KEYS.session);
  setSession = (session: StoredSession) => this.store.set(STATE_KEYS.session, session);

  getDevice = () => this.store.get<StoredDevice>(STATE_KEYS.device);
  setDevice = (device: StoredDevice) => this.store.set(STATE_KEYS.device, device);

  getConnection = () => this.store.get<StoredConnection>(STATE_KEYS.connection);
  setConnection = (connection: StoredConnection) =>
    this.store.set(STATE_KEYS.connection, connection);

  async getSync(): Promise<SyncState> {
    return (await this.store.get<SyncState>(STATE_KEYS.sync)) ?? INITIAL_SYNC_STATE;
  }

  async updateSync(patch: Partial<SyncState>): Promise<SyncState> {
    const next = { ...(await this.getSync()), ...patch };
    await this.store.set(STATE_KEYS.sync, next);
    return next;
  }

  /** Forgets the Portal connection and everything derived from it. */
  async clearConnection(): Promise<void> {
    await this.store.remove([STATE_KEYS.connection, STATE_KEYS.sync, STATE_KEYS.outbox]);
  }

  /** Removes everything this extension stored. */
  async clearAll(): Promise<void> {
    await this.store.remove([...ALLOWED_STATE_KEYS]);
  }
}

import type { StoredConnection, SyncState } from './storage/extension-state.js';
import type { SyncOutcome } from './sync/engine.js';

/** Commands the popup sends to the background service worker. */
export type Command =
  | { readonly type: 'getView' }
  | { readonly type: 'register'; readonly email: string; readonly password: string }
  | { readonly type: 'signIn'; readonly email: string; readonly password: string }
  | { readonly type: 'signOut' }
  | { readonly type: 'connect' }
  | { readonly type: 'disconnect' }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | { readonly type: 'syncNow' };

/** What the popup renders. Contains no tokens. */
export interface ExtensionView {
  readonly signedIn: boolean;
  readonly email?: string;
  readonly deviceRegistered: boolean;
  readonly connection?: StoredConnection;
  readonly sync: SyncState;
  readonly adapterAvailable: boolean;
  /** True while Portal reading is tested only against synthetic fixtures. */
  readonly adapterBeta: boolean;
  readonly consentVersion: string;
  readonly manualSyncAvailableAt?: string;
}

export type UserErrorCode =
  | 'invalid_credentials'
  | 'email_taken'
  | 'invalid_input'
  | 'session_expired'
  | 'network'
  | 'rate_limited'
  | 'not_connected'
  | 'unexpected';

export type CommandResult =
  | { readonly ok: true; readonly view: ExtensionView; readonly outcome?: SyncOutcome }
  | {
      readonly ok: false;
      readonly error: { readonly code: UserErrorCode };
      readonly view: ExtensionView;
    };

export const COMMAND_TYPES: readonly Command['type'][] = [
  'getView',
  'register',
  'signIn',
  'signOut',
  'connect',
  'disconnect',
  'pause',
  'resume',
  'syncNow',
];

/** Rejects anything that is not a well-formed command (messages can come from any page script). */
export function isCommand(message: unknown): message is Command {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const { type, email, password } = message as Record<string, unknown>;
  if (!COMMAND_TYPES.includes(type as Command['type'])) {
    return false;
  }
  if (type === 'register' || type === 'signIn') {
    return typeof email === 'string' && typeof password === 'string';
  }
  return true;
}

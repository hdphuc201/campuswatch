import type {
  ChangeEvent,
  DataExport,
  Delivery,
  NotificationPreferences,
  TelegramLinkStatus,
} from '@campuswatch/contracts';
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
  | { readonly type: 'syncNow' }
  | { readonly type: 'getChanges' }
  | { readonly type: 'getSettings' }
  | { readonly type: 'savePreferences'; readonly preferences: NotificationPreferences }
  | { readonly type: 'telegramLink' }
  | { readonly type: 'telegramUnlink' }
  | { readonly type: 'exportData'; readonly password: string }
  | { readonly type: 'deleteData'; readonly password: string }
  | { readonly type: 'deleteAccount'; readonly password: string };

/** Notification settings shown on the options page. */
export interface SettingsView {
  readonly preferences: NotificationPreferences;
  readonly telegram: TelegramLinkStatus;
  readonly deliveries: Delivery[];
}

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
  | 'register_sign_in_failed'
  | 'reauthentication_failed'
  | 'invalid_input'
  | 'session_expired'
  | 'network'
  | 'rate_limited'
  | 'not_connected'
  | 'telegram_unavailable'
  | 'unexpected';

export type CommandResult =
  | {
      readonly ok: true;
      readonly view: ExtensionView;
      readonly outcome?: SyncOutcome;
      /** Present for `getChanges`: the most recent changes, newest first. */
      readonly changes?: ChangeEvent[];
      /** Present for settings commands. */
      readonly settings?: SettingsView;
      /** Present for `exportData`. */
      readonly export?: DataExport;
    }
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
  'getChanges',
  'getSettings',
  'savePreferences',
  'telegramLink',
  'telegramUnlink',
  'exportData',
  'deleteData',
  'deleteAccount',
];

/** Rejects anything that is not a well-formed command (messages can come from any page script). */
export function isCommand(message: unknown): message is Command {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const { type, email, password, preferences } = message as Record<string, unknown>;
  if (!COMMAND_TYPES.includes(type as Command['type'])) {
    return false;
  }
  if (type === 'register' || type === 'signIn') {
    return typeof email === 'string' && typeof password === 'string';
  }
  if (type === 'exportData' || type === 'deleteData' || type === 'deleteAccount') {
    return typeof password === 'string';
  }
  if (type === 'savePreferences') {
    // Shape is validated against the shared schema by the controller.
    return typeof preferences === 'object' && preferences !== null;
  }
  return true;
}

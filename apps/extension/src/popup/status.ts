import type { ExtensionView, UserErrorCode } from '../messaging.js';

export interface StatusDescription {
  readonly tone: 'ok' | 'warn' | 'error' | 'neutral';
  readonly title: string;
  readonly detail: string;
}

export function formatRelative(iso: string | undefined, now: Date): string {
  if (!iso) {
    return 'never';
  }
  const minutes = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/**
 * Turns local sync state and the server connection status into one honest message.
 * "Connected" is shown only after the Portal was actually read.
 */
export function describeStatus(view: ExtensionView, now: Date): StatusDescription {
  const { connection, sync } = view;
  if (!connection) {
    return { tone: 'neutral', title: 'Not connected', detail: 'Connect your CITD Portal.' };
  }
  if (connection.status === 'PAUSED') {
    return {
      tone: 'neutral',
      title: 'Paused',
      detail: 'CampusWatch is not checking the Portal. Resume when you are ready.',
    };
  }
  if (!view.adapterAvailable) {
    return {
      tone: 'neutral',
      title: 'Portal reading not available yet',
      detail: 'This build cannot read the CITD Portal. Your connection is saved.',
    };
  }
  switch (sync.lastResult) {
    case 'login_required':
      return {
        tone: 'warn',
        title: 'Log in to the CITD Portal',
        detail: 'Open the Portal in Chrome and log in. CampusWatch checks again automatically.',
      };
    case 'device_revoked':
      return {
        tone: 'error',
        title: 'This browser was signed out',
        detail: 'Reconnect to keep monitoring on this computer.',
      };
    case 'network_error':
      return {
        tone: 'error',
        title: 'Cannot reach CampusWatch',
        detail: `Retrying automatically. Last successful check: ${formatRelative(sync.lastSuccessAt, now)}.`,
      };
    case 'portal_unavailable':
      return {
        tone: 'error',
        title: 'CITD Portal is not responding',
        detail: `Retrying automatically. Last successful check: ${formatRelative(sync.lastSuccessAt, now)}.`,
      };
    case 'adapter_needs_update':
      return {
        tone: 'error',
        title: 'CampusWatch needs an update',
        detail: 'The Portal layout changed and could not be read. We will fix it soon.',
      };
    case 'ok':
      return {
        tone: 'ok',
        title: 'Connected',
        detail: `Last checked ${formatRelative(sync.lastSuccessAt, now)}.`,
      };
    default:
      return {
        tone: 'neutral',
        title: 'Waiting for the first check',
        detail: 'Make sure you are logged in to the CITD Portal in Chrome.',
      };
  }
}

export const ERROR_MESSAGES: Record<UserErrorCode, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  register_sign_in_failed:
    'We could not sign you in. If you already have an account with this email, sign in with that password.',
  reauthentication_failed: 'Password is incorrect.',
  invalid_input: 'Check the email address and use a password of at least 12 characters.',
  session_expired: 'Your CampusWatch session ended. Please sign in again.',
  network: 'Cannot reach CampusWatch. Check your internet connection.',
  rate_limited: 'Too many attempts. Please wait a few minutes.',
  not_connected: 'The Portal connection no longer exists. Connect again.',
  telegram_unavailable: 'Telegram notifications are not available yet.',
  unexpected: 'Something went wrong. Please try again.',
};

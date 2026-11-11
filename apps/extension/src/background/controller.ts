import { notificationPreferencesSchema, type PortalConnection } from '@campuswatch/contracts';
import { ApiError, type CampusWatchApi, NetworkError, SessionExpiredError } from '../api/client.js';
import { CONSENT_VERSION, SYNC_POLICY } from '../config.js';
import type {
  Command,
  CommandResult,
  ExtensionView,
  SettingsView,
  UserErrorCode,
} from '../messaging.js';
import {
  type ExtensionState,
  INITIAL_SYNC_STATE,
  type StoredConnection,
} from '../storage/extension-state.js';
import type { SyncEngine } from '../sync/engine.js';
import type { SyncScheduler } from '../sync/schedule.js';

export interface ControllerDeps {
  readonly state: ExtensionState;
  readonly api: CampusWatchApi;
  readonly engine: SyncEngine;
  readonly scheduler: SyncScheduler;
  readonly extensionVersion: string;
  readonly adapterAvailable: boolean;
  readonly adapterBeta: boolean;
  readonly now: () => Date;
  /** Opens a URL in a new tab (Telegram deep link). */
  readonly openUrl?: (url: string) => Promise<void>;
}

class UserFacingError extends Error {
  constructor(readonly code: UserErrorCode) {
    super(code);
  }
}

const PORTAL_LOGIN_RECHECK_MS = 2 * 60 * 1000;
const RECENT_CHANGES = 10;

function toStoredConnection(connection: PortalConnection): StoredConnection {
  return {
    id: connection.id,
    status: connection.status,
    consentVersion: connection.consentVersion,
    lastSyncAt: connection.lastSyncAt,
  };
}

/** Handles popup commands. Runs only in the background service worker. */
export class ExtensionController {
  private lastPortalLoginCheck = 0;

  constructor(private readonly deps: ControllerDeps) {}

  async handle(command: Command): Promise<CommandResult> {
    try {
      if (command.type === 'getChanges') {
        const changes = (await this.deps.state.getSession())
          ? await this.deps.api.listChanges(RECENT_CHANGES)
          : [];
        return { ok: true, view: await this.view(), changes };
      }
      if (command.type === 'exportData') {
        const exported = await this.reauthenticated(() =>
          this.deps.api.exportData(command.password),
        );
        return { ok: true, view: await this.view(), export: exported };
      }
      if (command.type === 'deleteData') {
        await this.reauthenticated(() => this.deps.api.deleteData(command.password));
        await this.deps.state.clearConnection();
        await this.deps.scheduler.clear();
        return { ok: true, view: await this.view() };
      }
      if (command.type === 'deleteAccount') {
        await this.reauthenticated(() => this.deps.api.deleteAccount(command.password));
        await this.deps.state.clearAll();
        await this.deps.scheduler.clear();
        return { ok: true, view: await this.view() };
      }
      if (
        command.type === 'getSettings' ||
        command.type === 'savePreferences' ||
        command.type === 'telegramLink' ||
        command.type === 'telegramUnlink'
      ) {
        return { ok: true, view: await this.view(), settings: await this.settings(command) };
      }
      const outcome = await this.dispatch(command);
      return { ok: true, view: await this.view(), ...(outcome ? { outcome } : {}) };
    } catch (error) {
      return { ok: false, error: { code: await this.toErrorCode(error) }, view: await this.view() };
    }
  }

  async view(): Promise<ExtensionView> {
    const { state } = this.deps;
    const [session, device, connection, sync] = await Promise.all([
      state.getSession(),
      state.getDevice(),
      state.getConnection(),
      state.getSync(),
    ]);
    const manualAvailableAt = sync.lastManualSyncAt
      ? Date.parse(sync.lastManualSyncAt) + SYNC_POLICY.manualCooldownMs
      : 0;
    return {
      signedIn: Boolean(session),
      ...(session ? { email: session.email } : {}),
      deviceRegistered: Boolean(device),
      ...(connection ? { connection } : {}),
      sync,
      adapterAvailable: this.deps.adapterAvailable,
      adapterBeta: this.deps.adapterBeta,
      consentVersion: CONSENT_VERSION,
      ...(manualAvailableAt > this.deps.now().getTime()
        ? { manualSyncAvailableAt: new Date(manualAvailableAt).toISOString() }
        : {}),
    };
  }

  /** Called when a Portal page finishes loading: a new login may end LOGIN_REQUIRED. */
  async onPortalPageLoaded(): Promise<void> {
    const now = this.deps.now().getTime();
    const sync = await this.deps.state.getSync();
    if (sync.polling !== 'stopped' || now - this.lastPortalLoginCheck < PORTAL_LOGIN_RECHECK_MS) {
      return;
    }
    this.lastPortalLoginCheck = now;
    await this.deps.engine.run('portal-login');
  }

  /** Makes sure an alarm exists after a browser restart or extension update. */
  async onStartup(): Promise<void> {
    await this.deps.engine.run('startup');
  }

  private async dispatch(command: Command) {
    const { api, state, engine, scheduler } = this.deps;
    switch (command.type) {
      case 'getView':
        return undefined;
      case 'register':
        // The API answers the same for new and existing emails (no account discovery).
        await api.register(command.email, command.password);
        try {
          await this.signIn(command.email, command.password);
        } catch (error) {
          if (error instanceof UserFacingError && error.code === 'invalid_credentials') {
            throw new UserFacingError('register_sign_in_failed');
          }
          throw error;
        }
        return undefined;
      case 'signIn':
        await this.signIn(command.email, command.password);
        return undefined;
      case 'signOut':
        await this.signOut();
        return undefined;
      case 'connect': {
        await this.ensureDevice();
        const connection = await this.createOrAdoptConnection();
        await state.setConnection(toStoredConnection(connection));
        await state.updateSync(INITIAL_SYNC_STATE);
        // A new connection starts as LOGIN_REQUIRED; probe right away.
        return engine.run('connect');
      }
      case 'disconnect': {
        const connection = await state.getConnection();
        if (connection) {
          try {
            await api.deleteConnection(connection.id);
          } catch (error) {
            if (!(error instanceof ApiError && error.status === 404)) {
              throw error;
            }
          }
        }
        await state.clearConnection();
        await scheduler.clear();
        return undefined;
      }
      case 'pause': {
        const connection = await this.requireConnection();
        await state.setConnection(toStoredConnection(await api.pauseConnection(connection.id)));
        await scheduler.clear();
        return undefined;
      }
      case 'resume': {
        const connection = await this.requireConnection();
        await state.setConnection(toStoredConnection(await api.resumeConnection(connection.id)));
        await state.updateSync({ polling: 'active', consecutiveFailures: 0 });
        return engine.run('resume');
      }
      case 'syncNow':
        return engine.run('manual');
      case 'getChanges':
      case 'exportData':
      case 'deleteData':
      case 'deleteAccount':
      case 'getSettings':
      case 'savePreferences':
      case 'telegramLink':
      case 'telegramUnlink':
        return undefined;
    }
  }

  private async settings(
    command: Extract<
      Command,
      { type: 'getSettings' | 'savePreferences' | 'telegramLink' | 'telegramUnlink' }
    >,
  ): Promise<SettingsView> {
    const { api } = this.deps;
    if (command.type === 'savePreferences') {
      const parsed = notificationPreferencesSchema.safeParse(command.preferences);
      if (!parsed.success) {
        throw new UserFacingError('invalid_input');
      }
      await api.savePreferences(parsed.data);
    } else if (command.type === 'telegramLink') {
      try {
        const { deepLink } = await api.telegramStart();
        await this.deps.openUrl?.(deepLink);
      } catch (error) {
        if (error instanceof ApiError && error.status === 503) {
          throw new UserFacingError('telegram_unavailable');
        }
        throw error;
      }
    } else if (command.type === 'telegramUnlink') {
      await api.telegramUnlink();
    }
    const [preferences, telegram, deliveries] = await Promise.all([
      api.getPreferences(),
      api.telegramStatus(),
      api.listDeliveries(20),
    ]);
    return { preferences, telegram, deliveries };
  }

  /** Runs a password-confirmed request, mapping a wrong password to a clear error. */
  private async reauthenticated<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        throw new UserFacingError('reauthentication_failed');
      }
      throw error;
    }
  }

  private async signIn(email: string, password: string): Promise<void> {
    const { api, state } = this.deps;
    let tokens;
    try {
      tokens = await api.login(email, password);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw new UserFacingError('invalid_credentials');
      }
      throw error;
    }
    await state.clearAll();
    await state.setSession({
      email: email.trim().toLowerCase(),
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken,
    });
    await this.ensureDevice();
    const existing = (await api.listConnections()).find((c) => c.adapterKey === 'citd');
    if (existing) {
      await state.setConnection(toStoredConnection(existing));
      await this.deps.engine.run('startup');
    }
  }

  private async signOut(): Promise<void> {
    const { api, state, scheduler } = this.deps;
    const [session, device] = await Promise.all([state.getSession(), state.getDevice()]);
    // Best effort: local sign-out must succeed even when the API is unreachable.
    if (device) {
      await api.revokeDevice(device.id).catch(() => undefined);
    }
    if (session) {
      await api.logout(session.refreshToken).catch(() => undefined);
    }
    await state.clearAll();
    await scheduler.clear();
  }

  private async ensureDevice(): Promise<void> {
    const { api, state } = this.deps;
    if (await state.getDevice()) {
      return;
    }
    const registered = await api.registerDevice('Chrome extension', this.deps.extensionVersion);
    await state.setDevice({ id: registered.device.id, token: registered.deviceToken });
  }

  private async createOrAdoptConnection(): Promise<PortalConnection> {
    const { api } = this.deps;
    try {
      return await api.createConnection(CONSENT_VERSION);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const existing = (await api.listConnections()).find((c) => c.adapterKey === 'citd');
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  private async requireConnection(): Promise<StoredConnection> {
    const connection = await this.deps.state.getConnection();
    if (!connection) {
      throw new UserFacingError('not_connected');
    }
    return connection;
  }

  private async toErrorCode(error: unknown): Promise<UserErrorCode> {
    if (error instanceof UserFacingError) {
      return error.code;
    }
    if (error instanceof SessionExpiredError) {
      await this.deps.state.clearAll();
      await this.deps.scheduler.clear();
      return 'session_expired';
    }
    if (error instanceof NetworkError) {
      return 'network';
    }
    if (error instanceof ApiError) {
      if (error.status === 400) {
        return 'invalid_input';
      }
      if (error.status === 429) {
        return 'rate_limited';
      }
      if (error.status === 404) {
        return 'not_connected';
      }
    }
    return 'unexpected';
  }
}

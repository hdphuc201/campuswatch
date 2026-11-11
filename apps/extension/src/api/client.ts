import {
  type AuthTokensResponse,
  authTokensResponseSchema,
  type ChangeEvent,
  changeListResponseSchema,
  type DataExport,
  dataExportSchema,
  type Delivery,
  deliveryListResponseSchema,
  type NotificationPreferences,
  notificationPreferencesSchema,
  type PendingNotificationsResponse,
  pendingNotificationsResponseSchema,
  type PortalConnection,
  portalConnectionListResponseSchema,
  portalConnectionSchema,
  type ProbeReportRequest,
  type RegisterDeviceResponse,
  registerDeviceResponseSchema,
  type SnapshotRequest,
  type SyncRunResult,
  syncRunResultSchema,
  type TelegramLinkStartResponse,
  telegramLinkStartResponseSchema,
  type TelegramLinkStatus,
  telegramLinkStatusSchema,
} from '@campuswatch/contracts';
import type { ExtensionState } from '../storage/extension-state.js';

/** The API answered with a non-2xx status. */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`CampusWatch API responded with ${status}${code ? ` (${code})` : ''}`);
  }

  get transient(): boolean {
    return this.status >= 500 || this.status === 429 || this.status === 408;
  }
}

/** The API could not be reached at all. */
export class NetworkError extends Error {
  override readonly name = 'NetworkError';
}

/** The user's CampusWatch session ended (logged out elsewhere, or refresh token replayed). */
export class SessionExpiredError extends Error {
  override readonly name = 'SessionExpiredError';
}

export interface ApiClientDeps {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly state: ExtensionState;
}

type Auth = { kind: 'none' } | { kind: 'user' } | { kind: 'device' };

/**
 * Typed client for the CampusWatch API. Used only by the background service worker, which
 * is the single owner of tokens: refreshes are single-flight so a refresh token is never
 * presented twice (the server treats that as theft and ends the session).
 */
export class CampusWatchApi {
  private refreshing?: Promise<void>;

  constructor(private readonly deps: ApiClientDeps) {}

  register(email: string, password: string): Promise<void> {
    return this.request('POST', '/auth/register', { kind: 'none' }, { email, password });
  }

  login(email: string, password: string): Promise<AuthTokensResponse> {
    return this.request('POST', '/auth/login', { kind: 'none' }, { email, password }, (body) =>
      authTokensResponseSchema.parse(body),
    );
  }

  async logout(refreshToken: string): Promise<void> {
    await this.request('POST', '/auth/logout', { kind: 'none' }, { refreshToken });
  }

  registerDevice(name: string, extensionVersion: string): Promise<RegisterDeviceResponse> {
    return this.request(
      'POST',
      '/devices/register',
      { kind: 'user' },
      { name, extensionVersion },
      (body) => registerDeviceResponseSchema.parse(body),
    );
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await this.request('DELETE', `/devices/${deviceId}`, { kind: 'user' });
  }

  createConnection(consentVersion: string): Promise<PortalConnection> {
    return this.request(
      'POST',
      '/portal-connections',
      { kind: 'user' },
      { adapterKey: 'citd', consentVersion },
      parseConnection,
    );
  }

  async listConnections(): Promise<PortalConnection[]> {
    return this.request(
      'GET',
      '/portal-connections',
      { kind: 'user' },
      undefined,
      (body) => portalConnectionListResponseSchema.parse(body).connections,
    );
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.request('DELETE', `/portal-connections/${connectionId}`, { kind: 'user' });
  }

  pauseConnection(connectionId: string): Promise<PortalConnection> {
    return this.request(
      'POST',
      `/portal-connections/${connectionId}/pause`,
      { kind: 'user' },
      undefined,
      parseConnection,
    );
  }

  resumeConnection(connectionId: string): Promise<PortalConnection> {
    return this.request(
      'POST',
      `/portal-connections/${connectionId}/resume`,
      { kind: 'user' },
      undefined,
      parseConnection,
    );
  }

  reportProbe(connectionId: string, report: ProbeReportRequest): Promise<PortalConnection> {
    return this.request(
      'POST',
      `/portal-connections/${connectionId}/probe`,
      { kind: 'device' },
      report,
      parseConnection,
    );
  }

  /** Uploads a snapshot (device token). Retrying the same `syncRunId` is safe. */
  uploadSnapshot(snapshot: SnapshotRequest): Promise<SyncRunResult> {
    return this.request('POST', '/sync-runs', { kind: 'device' }, snapshot, (body) =>
      syncRunResultSchema.parse(body),
    );
  }

  listChanges(limit: number): Promise<ChangeEvent[]> {
    return this.request(
      'GET',
      `/changes?limit=${limit}`,
      { kind: 'user' },
      undefined,
      (body) => changeListResponseSchema.parse(body).changes,
    );
  }

  pendingNotifications(): Promise<PendingNotificationsResponse> {
    return this.request('GET', '/notifications/pending', { kind: 'device' }, undefined, (body) =>
      pendingNotificationsResponseSchema.parse(body),
    );
  }

  async ackNotifications(deliveryIds: string[]): Promise<void> {
    await this.request('POST', '/notifications/ack', { kind: 'device' }, { deliveryIds });
  }

  getPreferences(): Promise<NotificationPreferences> {
    return this.request('GET', '/notification-preferences', { kind: 'user' }, undefined, (body) =>
      notificationPreferencesSchema.parse(body),
    );
  }

  savePreferences(preferences: NotificationPreferences): Promise<NotificationPreferences> {
    return this.request('PUT', '/notification-preferences', { kind: 'user' }, preferences, (body) =>
      notificationPreferencesSchema.parse(body),
    );
  }

  listDeliveries(limit: number): Promise<Delivery[]> {
    return this.request(
      'GET',
      `/notifications?limit=${limit}`,
      { kind: 'user' },
      undefined,
      (body) => deliveryListResponseSchema.parse(body).deliveries,
    );
  }

  telegramStatus(): Promise<TelegramLinkStatus> {
    return this.request('GET', '/telegram/link', { kind: 'user' }, undefined, (body) =>
      telegramLinkStatusSchema.parse(body),
    );
  }

  telegramStart(): Promise<TelegramLinkStartResponse> {
    return this.request('POST', '/telegram/link/start', { kind: 'user' }, undefined, (body) =>
      telegramLinkStartResponseSchema.parse(body),
    );
  }

  async telegramUnlink(): Promise<void> {
    await this.request('DELETE', '/telegram/link', { kind: 'user' });
  }

  exportData(password: string): Promise<DataExport> {
    return this.request('POST', '/privacy/export', { kind: 'user' }, { password }, (body) =>
      dataExportSchema.parse(body),
    );
  }

  async deleteData(password: string): Promise<void> {
    await this.request('DELETE', '/privacy/data', { kind: 'user' }, { password });
  }

  async deleteAccount(password: string): Promise<void> {
    await this.request('DELETE', '/privacy/account', { kind: 'user' }, { password });
  }

  private async request<T = void>(
    method: string,
    path: string,
    auth: Auth,
    body?: unknown,
    parse?: (body: unknown) => T,
    retried = false,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const token = await this.tokenFor(auth);
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await this.deps.fetch(`${this.deps.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
      });
    } catch (error) {
      throw new NetworkError('CampusWatch API is unreachable', { cause: error });
    }

    if (response.status === 401 && auth.kind === 'user' && !retried) {
      await this.refreshSession();
      return this.request(method, path, auth, body, parse, true);
    }
    if (!response.ok) {
      throw new ApiError(response.status, await errorCode(response));
    }
    const text = await response.text();
    const json: unknown = text ? JSON.parse(text) : undefined;
    return parse ? parse(json) : (undefined as T);
  }

  private async tokenFor(auth: Auth): Promise<string | undefined> {
    if (auth.kind === 'user') {
      const session = await this.deps.state.getSession();
      if (!session) {
        throw new SessionExpiredError('Not signed in');
      }
      return session.accessToken;
    }
    if (auth.kind === 'device') {
      const device = await this.deps.state.getDevice();
      if (!device) {
        throw new ApiError(401, 'device_missing');
      }
      return device.token;
    }
    return undefined;
  }

  private refreshSession(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const session = await this.deps.state.getSession();
    if (!session) {
      throw new SessionExpiredError('Not signed in');
    }
    let tokens: AuthTokensResponse;
    try {
      tokens = await this.request(
        'POST',
        '/auth/refresh',
        { kind: 'none' },
        { refreshToken: session.refreshToken },
        (body) => authTokensResponseSchema.parse(body),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw new SessionExpiredError('CampusWatch session expired', { cause: error });
      }
      throw error;
    }
    await this.deps.state.setSession({
      email: session.email,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken,
    });
  }
}

function parseConnection(body: unknown): PortalConnection {
  return portalConnectionSchema.parse(body);
}

async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    if (typeof body.code === 'string') {
      return body.code;
    }
    return typeof body.message === 'string' ? body.message : undefined;
  } catch {
    return undefined;
  }
}

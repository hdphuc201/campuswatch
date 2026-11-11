import {
  type ChangeEvent,
  type ConnectionHealthState,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type PendingNotificationsResponse,
  type PortalConnection,
  type SnapshotRequest,
} from '@campuswatch/contracts';

interface FakeConnection extends PortalConnection {
  userEmail: string;
}

/**
 * In-memory stand-in for the CampusWatch API with the same auth rules: rotating single-use
 * refresh tokens, device tokens only on device routes, owner-scoped resources, paused
 * connections immune to probes.
 */
export function createFakeApi() {
  const users = new Map<string, string>();
  const accessTokens = new Map<string, string>();
  const refreshTokens = new Map<string, string>();
  const devices = new Map<string, { id: string; email: string; revoked: boolean }>();
  const connections = new Map<string, FakeConnection>();
  const calls: string[] = [];
  const snapshots: SnapshotRequest[] = [];
  const changes: ChangeEvent[] = [];
  const acked: string[] = [];
  const notifications: {
    pending: PendingNotificationsResponse;
    preferences: NotificationPreferences;
    telegramAvailable: boolean;
    telegramLinked: boolean;
  } = {
    pending: { notification: null, deliveryIds: [] },
    preferences: DEFAULT_NOTIFICATION_PREFERENCES,
    telegramAvailable: true,
    telegramLinked: false,
  };
  let counter = 0;
  let offline = false;
  let failNext: number | undefined;
  const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const issueTokens = (email: string) => {
    const accessToken = `access-${++counter}`;
    const refreshToken = `cwr_${++counter}`;
    accessTokens.set(accessToken, email);
    refreshTokens.set(refreshToken, email);
    return {
      tokenType: 'Bearer',
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      refreshToken,
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
  };

  const handle = (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit): Response => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url);
    const method = init?.method ?? 'GET';
    const path = url.pathname;
    calls.push(`${method} ${path}`);
    if (offline) {
      throw new TypeError('Failed to fetch');
    }
    if (failNext !== undefined) {
      const status = failNext;
      failNext = undefined;
      return json(status, { message: 'injected failure' });
    }
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, string>) : {};
    const bearer = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '');
    const userEmail = bearer ? accessTokens.get(bearer) : undefined;
    const device = bearer
      ? [...devices.values()].find((d) => `cwd_${d.id}` === bearer && !d.revoked)
      : undefined;

    if (method === 'POST' && path === '/auth/register') {
      // Same answer whether or not the email exists; an existing account is never changed.
      if (!users.has(body.email!)) {
        users.set(body.email!, body.password!);
      }
      return json(202, { status: 'accepted' });
    }
    if (method === 'POST' && path === '/auth/login') {
      return users.get(body.email!) === body.password
        ? json(200, issueTokens(body.email!))
        : json(401, { message: 'Invalid email or password' });
    }
    if (method === 'POST' && path === '/auth/refresh') {
      const email = refreshTokens.get(body.refreshToken!);
      if (!email) {
        return json(401, { message: 'Invalid refresh token' });
      }
      refreshTokens.delete(body.refreshToken!);
      return json(200, issueTokens(email));
    }
    if (method === 'POST' && path === '/auth/logout') {
      refreshTokens.delete(body.refreshToken!);
      return json(204);
    }

    const probeMatch = /^\/portal-connections\/([^/]+)\/probe$/.exec(path);
    if (probeMatch) {
      const connection = connections.get(probeMatch[1]!);
      if (!device) {
        return json(401);
      }
      if (!connection || connection.userEmail !== device.email) {
        return json(404);
      }
      if (connection.status !== 'PAUSED') {
        const status: Record<string, ConnectionHealthState> = {
          authenticated: 'CONNECTED',
          login_required: 'LOGIN_REQUIRED',
          unavailable: 'PORTAL_UNAVAILABLE',
        };
        connection.status = status[body.result!]!;
        connection.lastProbedAt = new Date().toISOString();
      }
      return json(200, strip(connection));
    }

    if (method === 'POST' && path === '/sync-runs') {
      if (!device) {
        return json(401);
      }
      const snapshot = body as unknown as SnapshotRequest;
      const connection = connections.get(snapshot.connectionId);
      if (!connection || connection.userEmail !== device.email) {
        return json(404);
      }
      if (connection.status === 'PAUSED') {
        return json(409, { code: 'connection_paused' });
      }
      snapshots.push(snapshot);
      const failed = snapshot.sources.filter((source) => source.status === 'error');
      connection.status = failed.some((source) => source.errorCode === 'LOGIN_REQUIRED')
        ? 'LOGIN_REQUIRED'
        : failed.some((source) => source.errorCode === 'ADAPTER_NEEDS_UPDATE')
          ? 'ADAPTER_NEEDS_UPDATE'
          : 'CONNECTED';
      connection.lastSyncAt = new Date().toISOString();
      return json(200, {
        syncRunId: snapshot.syncRunId,
        status: failed.length === 0 ? 'completed' : 'partial',
        entityCount: 0,
        changeCount: 0,
        replayed: false,
        sources: [],
        connection: strip(connection),
      });
    }

    if (path === '/notifications/pending' || path === '/notifications/ack') {
      if (!device) {
        return json(401);
      }
      if (path === '/notifications/ack') {
        acked.push(...(body as unknown as { deliveryIds: string[] }).deliveryIds);
        return json(204);
      }
      const batch = notifications.pending;
      notifications.pending = { notification: null, deliveryIds: [] };
      return json(200, batch);
    }

    if (!userEmail) {
      return json(401);
    }
    if (path === '/notification-preferences') {
      if (method === 'PUT') {
        notifications.preferences = body as unknown as NotificationPreferences;
      }
      return json(200, notifications.preferences);
    }
    if (path === '/notifications') {
      return json(200, { deliveries: [] });
    }
    if (path.startsWith('/privacy/')) {
      if (users.get(userEmail) !== body.password) {
        return json(403, { code: 'reauthentication_failed' });
      }
      if (path === '/privacy/account') {
        users.delete(userEmail);
      }
      if (path === '/privacy/data' || path === '/privacy/account') {
        for (const [id, connection] of connections) {
          if (connection.userEmail === userEmail) {
            connections.delete(id);
          }
        }
        return json(200, {
          status: 'deleted',
          scope: path.endsWith('account') ? 'account' : 'data',
        });
      }
      return json(200, {
        exportedAt: new Date().toISOString(),
        profile: {
          id: '00000000-0000-4000-8000-0000000000ff',
          email: userEmail,
          createdAt: new Date().toISOString(),
        },
        devices: [],
        connections: [],
        consents: [],
        entities: [],
        changes: [],
        notificationPreferences: notifications.preferences,
        deliveries: [],
        telegram: { linked: false, linkedAt: null },
      });
    }
    if (path === '/telegram/link/start') {
      return notifications.telegramAvailable
        ? json(200, {
            deepLink: 'https://t.me/CampusWatchBot?start=abcdefghijklmnopqrstuvwxyz012345',
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          })
        : json(503, { code: 'telegram_unavailable' });
    }
    if (path === '/telegram/link') {
      if (method === 'DELETE') {
        notifications.telegramLinked = false;
        return json(204);
      }
      return json(200, {
        available: notifications.telegramAvailable,
        linked: notifications.telegramLinked,
        linkedAt: notifications.telegramLinked ? new Date().toISOString() : null,
      });
    }
    if (method === 'GET' && path === '/changes') {
      return json(200, { changes, nextCursor: null });
    }
    if (method === 'POST' && path === '/devices/register') {
      const deviceId = id();
      devices.set(deviceId, { id: deviceId, email: userEmail, revoked: false });
      return json(201, {
        device: {
          id: deviceId,
          name: body.name,
          extensionVersion: body.extensionVersion,
          createdAt: new Date().toISOString(),
          lastSeenAt: null,
        },
        deviceToken: `cwd_${deviceId}`,
      });
    }
    const deviceMatch = /^\/devices\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && deviceMatch) {
      const target = devices.get(deviceMatch[1]!);
      if (!target || target.email !== userEmail) {
        return json(404);
      }
      target.revoked = true;
      return json(204);
    }
    if (path === '/portal-connections') {
      const own = [...connections.values()].filter((c) => c.userEmail === userEmail);
      if (method === 'GET') {
        return json(200, { connections: own.map(strip) });
      }
      if (own.length > 0) {
        return json(409, { message: 'A connection for this Portal already exists' });
      }
      const connection: FakeConnection = {
        id: id(),
        userEmail,
        adapterKey: 'citd',
        status: 'LOGIN_REQUIRED',
        consentVersion: body.consentVersion!,
        lastProbedAt: null,
        lastSyncAt: null,
        createdAt: new Date().toISOString(),
      };
      connections.set(connection.id, connection);
      return json(201, strip(connection));
    }
    const connectionMatch = /^\/portal-connections\/([^/]+)(?:\/(pause|resume))?$/.exec(path);
    if (connectionMatch) {
      const connection = connections.get(connectionMatch[1]!);
      if (!connection || connection.userEmail !== userEmail) {
        return json(404);
      }
      if (method === 'DELETE') {
        connections.delete(connection.id);
        return json(204);
      }
      if (connectionMatch[2] === 'pause') {
        connection.status = 'PAUSED';
      } else if (connectionMatch[2] === 'resume' && connection.status === 'PAUSED') {
        connection.status = 'LOGIN_REQUIRED';
      }
      return json(200, strip(connection));
    }
    return json(404);
  };

  const fetch: typeof globalThis.fetch = (input, init) => {
    try {
      return Promise.resolve(handle(input, init));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  return {
    fetch,
    calls,
    snapshots,
    changes,
    acked,
    notifications,
    connections,
    devices,
    /** Expires every access token, as if 15 minutes passed. */
    expireAccessTokens: () => accessTokens.clear(),
    setOffline: (value: boolean) => {
      offline = value;
    },
    failNextRequest: (status: number) => {
      failNext = status;
    },
  };
}

function strip(connection: FakeConnection): PortalConnection {
  const { userEmail: _userEmail, ...rest } = connection;
  return rest;
}

export type FakeApi = ReturnType<typeof createFakeApi>;

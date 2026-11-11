import { createHash } from 'node:crypto';
import {
  type ChangeEvent,
  type ChangeListQuery,
  type ChangeListResponse,
  type ConnectionHealthState,
  type EntityListResponse,
  type EntityType,
  type NormalizedEntity,
  type PortalConnection,
  SOURCE_ENTITY_TYPES,
  type SnapshotRequest,
  type SourceResult,
  type SyncRunResult,
} from '@campuswatch/contracts';
import {
  changeEvents,
  entities,
  portalConnections,
  type SourceResultJson,
  syncRuns,
} from '@campuswatch/db';
import { canonicalEntries, diffEntities, fingerprintEntity } from '@campuswatch/portal-core';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { DevicePrincipal } from '../auth/principal.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type ConnectionRow = typeof portalConnections.$inferSelect;
type SyncRunRow = typeof syncRuns.$inferSelect;
type ChangeRow = typeof changeEvents.$inferSelect;

const CHUNK = 500;

function chunks<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    result.push(items.slice(i, i + CHUNK));
  }
  return result;
}

function toPortalConnection(row: ConnectionRow): PortalConnection {
  return {
    id: row.id,
    adapterKey: row.adapterKey,
    status: row.status,
    consentVersion: row.consentVersion,
    lastProbedAt: row.lastProbedAt?.toISOString() ?? null,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toChangeEvent(row: ChangeRow): ChangeEvent {
  return {
    id: row.id,
    connectionId: row.connectionId,
    entityType: row.entityType,
    externalKey: row.externalKey,
    kind: row.kind,
    changedFields: row.changedFields,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Connection health after a sync (plan section 11). */
function healthAfterSync(results: SourceResultJson[]): ConnectionHealthState {
  const errors = results.filter((result) => result.status === 'error');
  if (errors.some((error) => error.errorCode === 'LOGIN_REQUIRED')) {
    return 'LOGIN_REQUIRED';
  }
  if (errors.length === results.length) {
    const code = errors[0]?.errorCode;
    return code === 'NETWORK_ERROR' || code === 'ADAPTER_NEEDS_UPDATE'
      ? code
      : 'PORTAL_UNAVAILABLE';
  }
  return errors.some((error) => error.errorCode === 'ADAPTER_NEEDS_UPDATE')
    ? 'ADAPTER_NEEDS_UPDATE'
    : 'CONNECTED';
}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return Number.isNaN(createdAt.getTime()) || !id || !uuid.test(id) ? null : { createdAt, id };
}

@Injectable()
export class SyncService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Applies a snapshot from one of the owner's devices. Runs in one transaction with the
   * connection row locked, so concurrent uploads for a connection are applied one at a time
   * and each real change produces exactly one change event.
   */
  async ingest(device: DevicePrincipal, request: SnapshotRequest): Promise<SyncRunResult> {
    return this.db.transaction(async (tx) => {
      const [connection] = await tx
        .select()
        .from(portalConnections)
        .where(
          and(
            eq(portalConnections.id, request.connectionId),
            eq(portalConnections.userId, device.userId),
          ),
        )
        .for('update');
      if (!connection) {
        throw new NotFoundException('Portal connection not found');
      }

      const [existing] = await tx
        .select()
        .from(syncRuns)
        .where(
          and(
            eq(syncRuns.connectionId, connection.id),
            eq(syncRuns.clientRunId, request.syncRunId),
          ),
        )
        .limit(1);
      if (existing) {
        return this.toResult(existing, connection, true);
      }
      if (connection.status === 'PAUSED') {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'connection_paused',
          message: 'The connection is paused',
        });
      }

      const [run] = await tx
        .insert(syncRuns)
        .values({
          connectionId: connection.id,
          userId: device.userId,
          deviceId: device.deviceId,
          clientRunId: request.syncRunId,
          status: 'failed',
          sourceResults: [],
          entityCount: 0,
          changeCount: 0,
          collectedAt: new Date(request.collectedAt),
        })
        .returning();
      if (!run) {
        throw new Error('Sync run insert returned no row');
      }

      const results: SourceResultJson[] = [];
      const newEvents: ChangeRow[] = [];
      let entityCount = 0;
      for (const snapshot of request.sources) {
        if (snapshot.status === 'error') {
          results.push({
            source: snapshot.source,
            status: 'error',
            errorCode: snapshot.errorCode,
            errorDetail: snapshot.errorDetail,
            entityCount: 0,
          });
          continue;
        }
        const applied = await this.applySource(
          tx,
          connection,
          run.id,
          snapshot.source,
          snapshot.entities,
        );
        entityCount += applied.entityCount;
        newEvents.push(...applied.events);
        results.push({
          source: snapshot.source,
          status: 'ok',
          entityCount: applied.entityCount,
          ...(applied.baseline ? { baseline: true } : {}),
        });
      }

      // Notifications are created in the same transaction as the changes they announce.
      await this.notifications.fanOut(tx, device.userId, newEvents);
      const changeCount = newEvents.length;

      const okCount = results.filter((result) => result.status === 'ok').length;
      const status = okCount === results.length ? 'completed' : okCount > 0 ? 'partial' : 'failed';
      const now = new Date();
      const [updatedConnection] = await tx
        .update(portalConnections)
        .set({
          status: healthAfterSync(results),
          updatedAt: now,
          syncedSources: [
            ...new Set([
              ...connection.syncedSources,
              ...results.filter((result) => result.status === 'ok').map((result) => result.source),
            ]),
          ],
          ...(okCount > 0 ? { lastSyncAt: now } : {}),
        })
        .where(eq(portalConnections.id, connection.id))
        .returning();
      const [finalRun] = await tx
        .update(syncRuns)
        .set({ status, sourceResults: results, entityCount, changeCount })
        .where(eq(syncRuns.id, run.id))
        .returning();
      return this.toResult(finalRun!, updatedConnection!, false);
    });
  }

  private async applySource(
    tx: Transaction,
    connection: ConnectionRow,
    runId: string,
    source: SnapshotRequest['sources'][number]['source'],
    incoming: NormalizedEntity[],
  ): Promise<{ entityCount: number; events: ChangeRow[]; baseline: boolean }> {
    const types = [...SOURCE_ENTITY_TYPES[source]];
    // Never trust client fingerprints: canonicalize and fingerprint again on the server.
    const next = await Promise.all(
      incoming.map(async (entity) => {
        const payload = Object.fromEntries(canonicalEntries(entity.payload));
        return {
          entityType: entity.entityType,
          externalKey: entity.externalKey,
          payload,
          fingerprint: await fingerprintEntity({ ...entity, payload }),
        };
      }),
    );
    const previousRows = await tx
      .select()
      .from(entities)
      .where(and(eq(entities.connectionId, connection.id), inArray(entities.entityType, types)));
    const previous = previousRows.map((row) => ({
      entityType: row.entityType,
      externalKey: row.externalKey,
      payload: row.payload,
      fingerprint: row.fingerprint,
    }));

    // Dashboard popups come and go: a notice that disappears is not a change worth recording.
    const keepRemoved = source === 'dashboardNotices';
    const changes = diffEntities(previous, next).filter(
      (change) => !(keepRemoved && change.kind === 'REMOVED'),
    );

    // The first successful sync of a source is a baseline: store it without change events.
    const baseline = !connection.syncedSources.includes(source);

    const now = new Date();
    for (const batch of chunks(next)) {
      await tx
        .insert(entities)
        .values(
          batch.map((entity) => ({
            connectionId: connection.id,
            userId: connection.userId,
            entityType: entity.entityType,
            externalKey: entity.externalKey,
            payload: entity.payload,
            fingerprint: entity.fingerprint,
          })),
        )
        .onConflictDoUpdate({
          target: [entities.connectionId, entities.entityType, entities.externalKey],
          set: {
            payload: sql`excluded.payload`,
            fingerprint: sql`excluded.fingerprint`,
            lastSeenAt: now,
            updatedAt: sql`CASE WHEN ${entities.fingerprint} <> excluded.fingerprint THEN now() ELSE ${entities.updatedAt} END`,
          },
        });
    }

    const removed = changes.filter((change) => change.kind === 'REMOVED');
    for (const type of types) {
      const keys = removed.filter((c) => c.entityType === type).map((c) => c.externalKey);
      for (const batch of chunks(keys)) {
        await tx
          .delete(entities)
          .where(
            and(
              eq(entities.connectionId, connection.id),
              eq(entities.entityType, type),
              inArray(entities.externalKey, batch),
            ),
          );
      }
    }

    const events: ChangeRow[] = [];
    if (!baseline && changes.length > 0) {
      const before = new Map(previous.map((e) => [`${e.entityType}\u0000${e.externalKey}`, e]));
      const after = new Map(next.map((e) => [`${e.entityType}\u0000${e.externalKey}`, e]));
      for (const batch of chunks(changes)) {
        const inserted = await tx
          .insert(changeEvents)
          .values(
            batch.map((change) => {
              const key = `${change.entityType}\u0000${change.externalKey}`;
              const old = before.get(key);
              const current = after.get(key);
              const state = current ?? old;
              if (!state) {
                throw new Error('Change without entity state');
              }
              return {
                connectionId: connection.id,
                userId: connection.userId,
                syncRunId: runId,
                entityType: change.entityType,
                externalKey: change.externalKey,
                kind: change.kind,
                changedFields: [...change.changedFields],
                payload: state.payload,
                fingerprint: change.fingerprint,
                previousFingerprint: old?.fingerprint ?? null,
                idempotencyKey: createHash('sha256')
                  .update(
                    [
                      connection.id,
                      change.entityType,
                      change.externalKey,
                      change.kind,
                      old?.fingerprint ?? '',
                      current?.fingerprint ?? '',
                      runId,
                    ].join('\u0000'),
                  )
                  .digest('hex'),
              };
            }),
          )
          .onConflictDoNothing({ target: changeEvents.idempotencyKey })
          .returning();
        events.push(...inserted);
      }
    }
    return { entityCount: next.length, events, baseline };
  }

  async listChanges(userId: string, query: ChangeListQuery): Promise<ChangeListResponse> {
    if (query.connectionId) {
      await this.assertOwnConnection(userId, query.connectionId);
    }
    const cursor = query.before ? decodeCursor(query.before) : null;
    const rows = await this.db
      .select()
      .from(changeEvents)
      .where(
        and(
          eq(changeEvents.userId, userId),
          query.connectionId ? eq(changeEvents.connectionId, query.connectionId) : undefined,
          query.entityType ? eq(changeEvents.entityType, query.entityType) : undefined,
          cursor
            ? or(
                lt(changeEvents.createdAt, cursor.createdAt),
                and(eq(changeEvents.createdAt, cursor.createdAt), lt(changeEvents.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(changeEvents.createdAt), desc(changeEvents.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      changes: page.map(toChangeEvent),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  async listEntities(
    userId: string,
    entityType: EntityType,
    connectionId?: string,
  ): Promise<EntityListResponse> {
    if (connectionId) {
      await this.assertOwnConnection(userId, connectionId);
    }
    const rows = await this.db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.userId, userId),
          eq(entities.entityType, entityType),
          connectionId ? eq(entities.connectionId, connectionId) : undefined,
        ),
      )
      .orderBy(asc(entities.externalKey));
    return {
      entities: rows.map((row) => ({
        connectionId: row.connectionId,
        entityType: row.entityType,
        externalKey: row.externalKey,
        payload: row.payload,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  private async assertOwnConnection(userId: string, connectionId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: portalConnections.id })
      .from(portalConnections)
      .where(and(eq(portalConnections.id, connectionId), eq(portalConnections.userId, userId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Portal connection not found');
    }
  }

  private toResult(run: SyncRunRow, connection: ConnectionRow, replayed: boolean): SyncRunResult {
    return {
      syncRunId: run.clientRunId,
      status: run.status,
      entityCount: run.entityCount,
      changeCount: run.changeCount,
      replayed,
      sources: run.sourceResults as SourceResult[],
      connection: toPortalConnection(connection),
    };
  }
}

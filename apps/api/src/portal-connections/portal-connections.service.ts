import type {
  ConnectionHealthState,
  CreatePortalConnectionRequest,
  PortalConnection,
  ProbeReportRequest,
} from '@campuswatch/contracts';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { DATABASE, type Database } from '../database/database.module.js';
import { isUniqueViolation } from '../database/errors.js';
import { consentAudits, portalConnections } from '../database/schema.js';

type ConnectionRow = typeof portalConnections.$inferSelect;

const PROBE_STATUS: Record<ProbeReportRequest['result'], ConnectionHealthState> = {
  authenticated: 'CONNECTED',
  login_required: 'LOGIN_REQUIRED',
  unavailable: 'PORTAL_UNAVAILABLE',
};

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

/** Every method takes the owner's id from the verified token and scopes all queries by it. */
@Injectable()
export class PortalConnectionsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Records consent and creates the connection. It starts as `LOGIN_REQUIRED` until the
   * extension reports a successful session probe.
   */
  async create(userId: string, input: CreatePortalConnectionRequest): Promise<PortalConnection> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(portalConnections)
          .values({
            userId,
            adapterKey: input.adapterKey,
            consentVersion: input.consentVersion,
            status: 'LOGIN_REQUIRED',
          })
          .returning();
        await tx.insert(consentAudits).values({
          userId,
          adapterKey: input.adapterKey,
          policyVersion: input.consentVersion,
        });
        if (!row) {
          throw new Error('Connection insert returned no row');
        }
        return toPortalConnection(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A connection for this Portal already exists');
      }
      throw error;
    }
  }

  async list(userId: string): Promise<PortalConnection[]> {
    const rows = await this.db
      .select()
      .from(portalConnections)
      .where(eq(portalConnections.userId, userId))
      .orderBy(asc(portalConnections.createdAt));
    return rows.map(toPortalConnection);
  }

  /** Disconnects the Portal and records the consent revocation. */
  async remove(userId: string, connectionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(portalConnections)
        .where(and(eq(portalConnections.id, connectionId), eq(portalConnections.userId, userId)))
        .returning({ adapterKey: portalConnections.adapterKey });
      if (!removed) {
        throw new NotFoundException('Portal connection not found');
      }
      await tx
        .update(consentAudits)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(consentAudits.userId, userId),
            eq(consentAudits.adapterKey, removed.adapterKey),
            isNull(consentAudits.revokedAt),
          ),
        );
    });
  }

  /** Stops automatic syncing until the owner resumes. Probes cannot override this state. */
  async pause(userId: string, connectionId: string): Promise<PortalConnection> {
    return this.setStatus(userId, connectionId, 'PAUSED');
  }

  /** Resumes a paused connection; it waits for the next probe to confirm the Portal session. */
  async resume(userId: string, connectionId: string): Promise<PortalConnection> {
    const now = new Date();
    const [row] = await this.db
      .update(portalConnections)
      .set({ status: 'LOGIN_REQUIRED', updatedAt: now })
      .where(
        and(
          eq(portalConnections.id, connectionId),
          eq(portalConnections.userId, userId),
          eq(portalConnections.status, 'PAUSED'),
        ),
      )
      .returning();
    return row ? toPortalConnection(row) : this.get(userId, connectionId);
  }

  async get(userId: string, connectionId: string): Promise<PortalConnection> {
    const [row] = await this.db
      .select()
      .from(portalConnections)
      .where(and(eq(portalConnections.id, connectionId), eq(portalConnections.userId, userId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Portal connection not found');
    }
    return toPortalConnection(row);
  }

  /**
   * Applies a session probe reported by one of the owner's devices. A paused connection is
   * returned unchanged: only the owner can resume it.
   */
  async reportProbe(
    ownerId: string,
    connectionId: string,
    report: ProbeReportRequest,
  ): Promise<PortalConnection> {
    const now = new Date();
    const [row] = await this.db
      .update(portalConnections)
      .set({ status: PROBE_STATUS[report.result], lastProbedAt: now, updatedAt: now })
      .where(
        and(
          eq(portalConnections.id, connectionId),
          eq(portalConnections.userId, ownerId),
          ne(portalConnections.status, 'PAUSED'),
        ),
      )
      .returning();
    return row ? toPortalConnection(row) : this.get(ownerId, connectionId);
  }

  private async setStatus(
    userId: string,
    connectionId: string,
    status: ConnectionHealthState,
  ): Promise<PortalConnection> {
    const [row] = await this.db
      .update(portalConnections)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(portalConnections.id, connectionId), eq(portalConnections.userId, userId)))
      .returning();
    if (!row) {
      throw new NotFoundException('Portal connection not found');
    }
    return toPortalConnection(row);
  }
}

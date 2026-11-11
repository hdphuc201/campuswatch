import {
  authSessions,
  changeEvents,
  devices,
  notificationDeliveries,
  syncRuns,
  telegramLinkNonces,
} from '@campuswatch/db';
import { and, inArray, isNotNull, lt, notExists, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export interface RetentionPolicy {
  /** Change history (and its deliveries). Plan default: 12 months. */
  readonly historyDays: number;
  /** Operational records: finished deliveries, sync runs without history, revoked devices. */
  readonly operationalDays: number;
}

export type RetentionReport = Record<
  'changeEvents' | 'deliveries' | 'syncRuns' | 'authSessions' | 'linkNonces' | 'revokedDevices',
  number
>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes data past its retention period (implementation plan, section 11). Current Portal
 * entities are kept while the connection exists; users delete them via privacy endpoints.
 */
export class RetentionService {
  constructor(
    private readonly db: NodePgDatabase,
    private readonly policy: RetentionPolicy,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(): Promise<RetentionReport> {
    const now = this.now().getTime();
    const historyCutoff = new Date(now - this.policy.historyDays * DAY_MS);
    const operationalCutoff = new Date(now - this.policy.operationalDays * DAY_MS);
    const credentialCutoff = new Date(now - 30 * DAY_MS);

    const changeEventRows = await this.db
      .delete(changeEvents)
      .where(lt(changeEvents.createdAt, historyCutoff))
      .returning({ id: changeEvents.id });
    const deliveryRows = await this.db
      .delete(notificationDeliveries)
      .where(
        and(
          inArray(notificationDeliveries.status, ['sent', 'skipped', 'failed']),
          lt(notificationDeliveries.createdAt, operationalCutoff),
        ),
      )
      .returning({ id: notificationDeliveries.id });
    // A sync run that still anchors change history is kept with it.
    const syncRunRows = await this.db
      .delete(syncRuns)
      .where(
        and(
          lt(syncRuns.receivedAt, operationalCutoff),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(changeEvents)
              .where(sql`${changeEvents.syncRunId} = ${syncRuns.id}`),
          ),
        ),
      )
      .returning({ id: syncRuns.id });
    const sessionRows = await this.db
      .delete(authSessions)
      .where(
        or(
          lt(authSessions.expiresAt, credentialCutoff),
          lt(authSessions.revokedAt, credentialCutoff),
        ),
      )
      .returning({ id: authSessions.id });
    const nonceRows = await this.db
      .delete(telegramLinkNonces)
      .where(lt(telegramLinkNonces.expiresAt, new Date(now - DAY_MS)))
      .returning({ id: telegramLinkNonces.id });
    const deviceRows = await this.db
      .delete(devices)
      .where(and(isNotNull(devices.revokedAt), lt(devices.revokedAt, operationalCutoff)))
      .returning({ id: devices.id });

    return {
      changeEvents: changeEventRows.length,
      deliveries: deliveryRows.length,
      syncRuns: syncRunRows.length,
      authSessions: sessionRows.length,
      linkNonces: nonceRows.length,
      revokedDevices: deviceRows.length,
    };
  }
}

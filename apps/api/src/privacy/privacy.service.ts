import type { ConsentListResponse, DataExport, DeletionResult } from '@campuswatch/contracts';
import {
  changeEvents,
  consentAudits,
  devices,
  entities,
  notificationPreferences,
  portalConnections,
  telegramLinkNonces,
  telegramLinks,
  users,
} from '@campuswatch/db';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { PasswordHasher } from '../auth/password-hasher.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const iso = (value: Date | null) => value?.toISOString() ?? null;

/** Export, consent history, and account-scoped deletion (implementation plan, section 11). */
@Injectable()
export class PrivacyService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly passwords: PasswordHasher,
    private readonly notifications: NotificationsService,
  ) {}

  /** Sensitive operations require the current password, not just a valid access token. */
  async reauthenticate(userId: string, password: string): Promise<void> {
    const [user] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const valid = user
      ? await this.passwords.verify(user.passwordHash, password)
      : await this.passwords.verifyAgainstDummy(password);
    if (!valid) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'reauthentication_failed',
        message: 'Password is incorrect',
      });
    }
  }

  async consents(userId: string): Promise<ConsentListResponse> {
    const rows = await this.db
      .select()
      .from(consentAudits)
      .where(eq(consentAudits.userId, userId))
      .orderBy(asc(consentAudits.grantedAt));
    return {
      consents: rows.map((row) => ({
        adapterKey: row.adapterKey,
        policyVersion: row.policyVersion,
        grantedAt: row.grantedAt.toISOString(),
        revokedAt: iso(row.revokedAt),
      })),
    };
  }

  async export(userId: string): Promise<DataExport> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new ForbiddenException();
    }
    const [
      deviceRows,
      connectionRows,
      entityRows,
      changeRows,
      link,
      consentList,
      preferences,
      deliveries,
    ] = await Promise.all([
      this.db.select().from(devices).where(eq(devices.userId, userId)),
      this.db.select().from(portalConnections).where(eq(portalConnections.userId, userId)),
      this.db.select().from(entities).where(eq(entities.userId, userId)),
      this.db
        .select()
        .from(changeEvents)
        .where(eq(changeEvents.userId, userId))
        .orderBy(desc(changeEvents.createdAt)),
      this.db
        .select({ linkedAt: telegramLinks.linkedAt })
        .from(telegramLinks)
        .where(eq(telegramLinks.userId, userId))
        .limit(1),
      this.consents(userId),
      this.notifications.getPreferences(userId),
      this.notifications.listDeliveries(userId, 10_000),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      profile: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() },
      // Device and refresh tokens are stored only as hashes and are never exported.
      devices: deviceRows.map((row) => ({
        id: row.id,
        name: row.name,
        extensionVersion: row.extensionVersion,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: iso(row.lastSeenAt),
      })),
      connections: connectionRows.map((row) => ({
        id: row.id,
        adapterKey: row.adapterKey,
        status: row.status,
        consentVersion: row.consentVersion,
        lastProbedAt: iso(row.lastProbedAt),
        lastSyncAt: iso(row.lastSyncAt),
        createdAt: row.createdAt.toISOString(),
      })),
      consents: consentList.consents,
      entities: entityRows.map((row) => ({
        connectionId: row.connectionId,
        entityType: row.entityType,
        externalKey: row.externalKey,
        payload: row.payload,
        updatedAt: row.updatedAt.toISOString(),
      })),
      changes: changeRows.map((row) => ({
        id: row.id,
        connectionId: row.connectionId,
        entityType: row.entityType,
        externalKey: row.externalKey,
        kind: row.kind,
        changedFields: row.changedFields,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
      })),
      notificationPreferences: preferences,
      deliveries,
      // The Telegram chat id is encrypted at rest and not exported.
      telegram: { linked: link.length > 0, linkedAt: iso(link[0]?.linkedAt ?? null) },
    };
  }

  /**
   * Deletes all Portal data and notification settings but keeps the account: connections
   * (cascading to entities, change history, sync runs, and deliveries), Telegram link, and
   * preferences. Consent records stay (without academic data) and are marked revoked.
   */
  async deleteData(userId: string): Promise<DeletionResult> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(consentAudits)
        .set({ revokedAt: new Date() })
        .where(and(eq(consentAudits.userId, userId), isNull(consentAudits.revokedAt)));
      await tx.delete(portalConnections).where(eq(portalConnections.userId, userId));
      await tx.delete(telegramLinks).where(eq(telegramLinks.userId, userId));
      await tx.delete(telegramLinkNonces).where(eq(telegramLinkNonces.userId, userId));
      await tx.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
    });
    return { status: 'deleted', scope: 'data' };
  }

  /** Deletes the account and everything that references it (foreign keys cascade). */
  async deleteAccount(userId: string): Promise<DeletionResult> {
    await this.db.delete(users).where(eq(users.id, userId));
    return { status: 'deleted', scope: 'account' };
  }
}

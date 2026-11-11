import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type Delivery,
  type NotificationChannel,
  type NotificationPreferences,
  notificationPreferencesSchema,
  type PendingNotificationsResponse,
} from '@campuswatch/contracts';
import {
  changeEvents,
  notificationDeliveries,
  notificationPreferences,
  telegramLinks,
} from '@campuswatch/db';
import {
  CATEGORY_OF,
  deliverAfter,
  isNotifiable,
  renderNotification,
  URGENT_CATEGORIES,
} from '@campuswatch/notifications';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { DevicePrincipal } from '../auth/principal.js';
import type { ApiConfig } from '../config.js';
import { API_CONFIG } from '../config.module.js';
import { DATABASE, type Database } from '../database/database.module.js';

type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
type ChangeRow = typeof changeEvents.$inferSelect;

/** How long a device may hold Chrome deliveries before another device can take them. */
const CLAIM_MS = 5 * 60 * 1000;
const MAX_BATCH = 50;

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async getPreferences(
    userId: string,
    executor: Executor = this.db,
  ): Promise<NotificationPreferences> {
    const [row] = await executor
      .select({ settings: notificationPreferences.settings })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    const parsed = notificationPreferencesSchema.safeParse(row?.settings);
    return parsed.success ? parsed.data : DEFAULT_NOTIFICATION_PREFERENCES;
  }

  async updatePreferences(
    userId: string,
    preferences: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    await this.db
      .insert(notificationPreferences)
      .values({ userId, settings: preferences })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { settings: preferences, updatedAt: new Date() },
      });
    return preferences;
  }

  /**
   * Creates delivery rows for new change events, inside the ingest transaction, so a change
   * and its notifications are committed together and never duplicated.
   */
  async fanOut(executor: Executor, userId: string, events: ChangeRow[]): Promise<number> {
    const notifiable = events.filter(isNotifiable);
    if (notifiable.length === 0) {
      return 0;
    }
    const preferences = await this.getPreferences(userId, executor);
    const [link] = this.config.telegram
      ? await executor
          .select({ userId: telegramLinks.userId })
          .from(telegramLinks)
          .where(eq(telegramLinks.userId, userId))
          .limit(1)
      : [];
    const channels: NotificationChannel[] = link ? ['chrome', 'telegram'] : ['chrome'];
    const now = new Date();

    const rows = notifiable.flatMap((event) => {
      const category = CATEGORY_OF[event.entityType];
      const urgent = URGENT_CATEGORIES.has(category);
      return channels
        .filter((channel) => preferences.channels[channel][category])
        .map((channel) => ({
          userId,
          changeEventId: event.id,
          channel,
          category,
          urgent,
          deliverAfter: deliverAfter(now, {
            urgent,
            quietHours: preferences.quietHours,
            timeZone: preferences.timezone,
          }),
        }));
    });
    if (rows.length === 0) {
      return 0;
    }
    const inserted = await executor
      .insert(notificationDeliveries)
      .values(rows)
      .onConflictDoNothing({
        target: [notificationDeliveries.changeEventId, notificationDeliveries.channel],
      })
      .returning({ id: notificationDeliveries.id });
    return inserted.length;
  }

  /**
   * Claims the device owner's due Chrome deliveries and renders them as one notification.
   * A claim lasts 5 minutes; unacknowledged deliveries then become available again.
   */
  async claimChrome(device: DevicePrincipal): Promise<PendingNotificationsResponse> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const due = await tx
        .select({
          id: notificationDeliveries.id,
          changeEventId: notificationDeliveries.changeEventId,
        })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.userId, device.userId),
            eq(notificationDeliveries.channel, 'chrome'),
            lte(notificationDeliveries.deliverAfter, now),
            or(
              eq(notificationDeliveries.status, 'pending'),
              and(
                eq(notificationDeliveries.status, 'sending'),
                lt(notificationDeliveries.claimedUntil, now),
              ),
            ),
          ),
        )
        .orderBy(asc(notificationDeliveries.createdAt))
        .limit(MAX_BATCH)
        .for('update', { skipLocked: true });
      if (due.length === 0) {
        return { notification: null, deliveryIds: [] };
      }
      const ids = due.map((row) => row.id);
      await tx
        .update(notificationDeliveries)
        .set({
          status: 'sending',
          claimedUntil: new Date(now.getTime() + CLAIM_MS),
          attempts: sql`${notificationDeliveries.attempts} + 1`,
        })
        .where(inArray(notificationDeliveries.id, ids));
      const events = await tx
        .select()
        .from(changeEvents)
        .where(
          and(
            inArray(
              changeEvents.id,
              due.map((row) => row.changeEventId),
            ),
            eq(changeEvents.userId, device.userId),
          ),
        );
      const preferences = await this.getPreferences(device.userId, tx);
      return {
        notification: renderNotification(events, preferences.detailLevel.chrome),
        deliveryIds: ids,
      };
    });
  }

  /** Marks claimed Chrome deliveries as shown. Ids of other users are silently ignored. */
  async ackChrome(device: DevicePrincipal, deliveryIds: string[]): Promise<void> {
    await this.db
      .update(notificationDeliveries)
      .set({ status: 'sent', sentAt: new Date(), claimedUntil: null })
      .where(
        and(
          inArray(notificationDeliveries.id, deliveryIds),
          eq(notificationDeliveries.userId, device.userId),
          eq(notificationDeliveries.channel, 'chrome'),
          eq(notificationDeliveries.status, 'sending'),
        ),
      );
  }

  async listDeliveries(userId: string, limit: number): Promise<Delivery[]> {
    const rows = await this.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.userId, userId))
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      changeEventId: row.changeEventId,
      channel: row.channel,
      category: row.category,
      status: row.status,
      attempts: row.attempts,
      deliverAfter: row.deliverAfter.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
      lastErrorCode: row.lastErrorCode,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationPreferencesSchema,
} from '@campuswatch/contracts';
import {
  changeEvents,
  notificationDeliveries,
  notificationPreferences,
  telegramLinks,
} from '@campuswatch/db';
import { renderNotification } from '@campuswatch/notifications';
import {
  type ChatIdCipher,
  TelegramApiError,
  type TelegramClient,
} from '@campuswatch/notifications/server';
import { and, asc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

type DeliveryRow = typeof notificationDeliveries.$inferSelect;

export const TELEGRAM_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
export const MAX_TELEGRAM_ATTEMPTS = 5;
/** A crashed worker's claim expires after this long, so another worker can take over. */
const CLAIM_MS = 2 * 60 * 1000;

export interface DispatchResult {
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}

/**
 * Sends due Telegram deliveries: one message per user per run (a batch summary), retries
 * with backoff, and stops for chats that blocked the bot. Rows are claimed with
 * `FOR UPDATE SKIP LOCKED`, so several workers never send the same delivery.
 */
export class TelegramDispatcher {
  constructor(
    private readonly db: NodePgDatabase,
    private readonly client: TelegramClient,
    private readonly cipher: ChatIdCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async dispatchDue(limit = 200): Promise<DispatchResult> {
    const result: DispatchResult = { sent: 0, retried: 0, failed: 0, skipped: 0 };
    const claimed = await this.claim(limit);
    const byUser = new Map<string, DeliveryRow[]>();
    for (const row of claimed) {
      byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
    }
    for (const [userId, rows] of byUser) {
      await this.dispatchUser(userId, rows, result);
    }
    return result;
  }

  private async claim(limit: number): Promise<DeliveryRow[]> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.channel, 'telegram'),
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
        .limit(limit)
        .for('update', { skipLocked: true });
      if (rows.length === 0) {
        return [];
      }
      await tx
        .update(notificationDeliveries)
        .set({
          status: 'sending',
          claimedUntil: new Date(now.getTime() + CLAIM_MS),
          attempts: sql`${notificationDeliveries.attempts} + 1`,
        })
        .where(
          inArray(
            notificationDeliveries.id,
            rows.map((row) => row.id),
          ),
        );
      return rows.map((row) => ({ ...row, attempts: row.attempts + 1 }));
    });
  }

  private async dispatchUser(userId: string, rows: DeliveryRow[], result: DispatchResult) {
    const [link] = await this.db
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.userId, userId))
      .limit(1);
    if (!link) {
      await this.finish(rows, 'skipped', 'not_linked');
      result.skipped += rows.length;
      return;
    }

    let chatId: string;
    try {
      chatId = this.cipher.decrypt(link.chatIdEncrypted);
    } catch {
      await this.finish(rows, 'failed', 'decrypt_failed');
      result.failed += rows.length;
      return;
    }

    const events = await this.db
      .select()
      .from(changeEvents)
      .where(
        and(
          inArray(
            changeEvents.id,
            rows.map((row) => row.changeEventId),
          ),
          eq(changeEvents.userId, userId),
        ),
      );
    const [preferencesRow] = await this.db
      .select({ settings: notificationPreferences.settings })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    const preferences = notificationPreferencesSchema.safeParse(preferencesRow?.settings);
    const detail = (preferences.success ? preferences.data : DEFAULT_NOTIFICATION_PREFERENCES)
      .detailLevel.telegram;
    const { title, body } = renderNotification(events, detail);

    try {
      await this.client.sendMessage(chatId, `${title}\n\n${body}`);
      await this.finish(rows, 'sent', null);
      result.sent += rows.length;
    } catch (error) {
      if (error instanceof TelegramApiError && error.chatGone) {
        // The user blocked the bot or deleted the chat: unlink and stop.
        await this.db.delete(telegramLinks).where(eq(telegramLinks.userId, userId));
        await this.finish(rows, 'skipped', 'telegram_chat_gone');
        result.skipped += rows.length;
        return;
      }
      const code =
        error instanceof TelegramApiError ? `telegram_${error.status}` : 'telegram_error';
      const retryable = !(error instanceof TelegramApiError) || error.retryable;
      for (const row of rows) {
        const delay = TELEGRAM_RETRY_DELAYS_MS[row.attempts - 1];
        if (retryable && row.attempts < MAX_TELEGRAM_ATTEMPTS && delay !== undefined) {
          await this.db
            .update(notificationDeliveries)
            .set({
              status: 'pending',
              claimedUntil: null,
              lastErrorCode: code,
              deliverAfter: new Date(this.now().getTime() + delay),
            })
            .where(
              and(
                eq(notificationDeliveries.id, row.id),
                eq(notificationDeliveries.status, 'sending'),
              ),
            );
          result.retried += 1;
        } else {
          await this.finish([row], 'failed', code);
          result.failed += 1;
        }
      }
    }
  }

  /** Final state for claimed rows. Rows changed meanwhile (e.g. unlinked) are left alone. */
  private async finish(
    rows: DeliveryRow[],
    status: 'sent' | 'failed' | 'skipped',
    errorCode: string | null,
  ): Promise<void> {
    await this.db
      .update(notificationDeliveries)
      .set({
        status,
        claimedUntil: null,
        lastErrorCode: errorCode,
        ...(status === 'sent' ? { sentAt: this.now() } : {}),
      })
      .where(
        and(
          inArray(
            notificationDeliveries.id,
            rows.map((row) => row.id),
          ),
          eq(notificationDeliveries.status, 'sending'),
        ),
      );
  }
}

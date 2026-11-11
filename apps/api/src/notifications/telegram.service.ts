import { createHash, randomBytes } from 'node:crypto';
import type { TelegramLinkStartResponse, TelegramLinkStatus } from '@campuswatch/contracts';
import { notificationDeliveries, telegramLinkNonces, telegramLinks } from '@campuswatch/db';
import {
  type ChatIdCipher,
  isStopCommand,
  parseStartCommand,
  secretsEqual,
  type TelegramClient,
  telegramUpdateSchema,
} from '@campuswatch/notifications/server';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { ApiConfig } from '../config.js';
import { API_CONFIG } from '../config.module.js';
import { DATABASE, type Database } from '../database/database.module.js';

export const TELEGRAM_CLIENT = Symbol('TELEGRAM_CLIENT');
export const CHAT_ID_CIPHER = Symbol('CHAT_ID_CIPHER');

const NONCE_TTL_MS = 10 * 60 * 1000;
const hashNonce = (nonce: string) => createHash('sha256').update(nonce).digest('hex');

/** Telegram linking (plan section 10): one-time code, webhook secret, encrypted chat id. */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(TELEGRAM_CLIENT) private readonly client: TelegramClient | null,
    @Inject(CHAT_ID_CIPHER) private readonly cipher: ChatIdCipher | null,
  ) {}

  async status(userId: string): Promise<TelegramLinkStatus> {
    const [link] = await this.db
      .select({ linkedAt: telegramLinks.linkedAt })
      .from(telegramLinks)
      .where(eq(telegramLinks.userId, userId))
      .limit(1);
    return {
      available: this.config.telegram !== null,
      linked: Boolean(link),
      linkedAt: link?.linkedAt.toISOString() ?? null,
    };
  }

  async startLink(userId: string): Promise<TelegramLinkStartResponse> {
    const telegram = this.config.telegram;
    if (!telegram) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        code: 'telegram_unavailable',
        message: 'Telegram notifications are not available',
      });
    }
    const nonce = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
    await this.db.transaction(async (tx) => {
      // Only the newest code works.
      await tx
        .delete(telegramLinkNonces)
        .where(and(eq(telegramLinkNonces.userId, userId), isNull(telegramLinkNonces.usedAt)));
      await tx
        .insert(telegramLinkNonces)
        .values({ userId, nonceHash: hashNonce(nonce), expiresAt });
    });
    return {
      deepLink: `https://t.me/${telegram.botUsername}?start=${nonce}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Unlinks and cancels pending Telegram deliveries immediately. */
  async unlink(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(telegramLinks).where(eq(telegramLinks.userId, userId));
      await tx
        .update(notificationDeliveries)
        .set({ status: 'skipped', lastErrorCode: 'unlinked', claimedUntil: null })
        .where(
          and(
            eq(notificationDeliveries.userId, userId),
            eq(notificationDeliveries.channel, 'telegram'),
            inArray(notificationDeliveries.status, ['pending', 'sending']),
          ),
        );
    });
  }

  /**
   * Handles a Telegram webhook update. The secret header is verified first; afterwards the
   * endpoint always answers 200 so Telegram does not retry malformed or unrelated updates.
   */
  async handleWebhook(secretHeader: string | undefined, body: unknown): Promise<void> {
    const telegram = this.config.telegram;
    if (!telegram || !secretsEqual(secretHeader, telegram.webhookSecret)) {
      throw new UnauthorizedException();
    }
    const parsed = telegramUpdateSchema.safeParse(body);
    const message = parsed.success ? parsed.data.message : undefined;
    if (!message || message.chat.type !== 'private' || !this.cipher) {
      return;
    }
    const chatId = String(message.chat.id);

    if (isStopCommand(message.text)) {
      await this.unlinkChat(chatId);
      await this.reply(chatId, 'CampusWatch notifications are turned off for this chat.');
      return;
    }
    const nonce = parseStartCommand(message.text);
    if (!nonce) {
      await this.reply(
        chatId,
        'To link this chat, open CampusWatch → Notification settings → Link Telegram.',
      );
      return;
    }
    const userId = await this.consumeNonce(nonce);
    if (!userId) {
      await this.reply(
        chatId,
        'This link has expired or was already used. Start again in CampusWatch.',
      );
      return;
    }
    await this.db
      .insert(telegramLinks)
      .values({
        userId,
        chatIdEncrypted: this.cipher.encrypt(chatId),
        chatIdHash: this.cipher.hash(chatId),
      })
      .onConflictDoUpdate({
        target: telegramLinks.userId,
        set: {
          chatIdEncrypted: this.cipher.encrypt(chatId),
          chatIdHash: this.cipher.hash(chatId),
          linkedAt: new Date(),
        },
      });
    await this.reply(
      chatId,
      'CampusWatch is linked. You will get a message here when your data changes.',
    );
  }

  private async consumeNonce(nonce: string): Promise<string | null> {
    const [used] = await this.db
      .update(telegramLinkNonces)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(telegramLinkNonces.nonceHash, hashNonce(nonce)),
          isNull(telegramLinkNonces.usedAt),
          gt(telegramLinkNonces.expiresAt, new Date()),
        ),
      )
      .returning({ userId: telegramLinkNonces.userId });
    return used?.userId ?? null;
  }

  private async unlinkChat(chatId: string): Promise<void> {
    if (!this.cipher) {
      return;
    }
    const links = await this.db
      .select({ userId: telegramLinks.userId })
      .from(telegramLinks)
      .where(eq(telegramLinks.chatIdHash, this.cipher.hash(chatId)));
    for (const link of links) {
      await this.unlink(link.userId);
    }
  }

  private async reply(chatId: string, text: string): Promise<void> {
    try {
      await this.client?.sendMessage(chatId, text);
    } catch {
      // A failed confirmation must not break linking; never log the chat id.
      this.logger.warn('Telegram reply failed');
    }
  }
}

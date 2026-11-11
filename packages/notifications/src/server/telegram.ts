import { z } from 'zod';

/** A failed Bot API call. `description` never contains the bot token. */
export class TelegramApiError extends Error {
  override readonly name = 'TelegramApiError';

  constructor(
    /** HTTP status, or 0 when Telegram could not be reached. */
    readonly status: number,
    readonly description: string,
  ) {
    super(`Telegram API error ${status}: ${description}`);
  }

  /** The user blocked the bot or deleted the chat: stop sending to it. */
  get chatGone(): boolean {
    return this.status === 403 || (this.status === 400 && /chat not found/i.test(this.description));
  }

  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface TelegramClient {
  sendMessage(chatId: string, text: string): Promise<void>;
}

const TELEGRAM_API = 'https://api.telegram.org';

/** Bot API client. The token appears only in the request URL and is never logged or thrown. */
export function createHttpTelegramClient(
  botToken: string,
  fetchImpl: typeof fetch = fetch,
): TelegramClient {
  return {
    async sendMessage(chatId, text) {
      let response: Response;
      try {
        response = await fetchImpl(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new TelegramApiError(0, 'network error');
      }
      if (!response.ok) {
        let description = 'request failed';
        try {
          const body = (await response.json()) as { description?: unknown };
          if (typeof body.description === 'string') {
            description = body.description.replaceAll(botToken, '[redacted]').slice(0, 200);
          }
        } catch {
          // Keep the generic description.
        }
        throw new TelegramApiError(response.status, description);
      }
    },
  };
}

/** Records messages instead of sending them (tests, and deployments without a bot). */
export class FakeTelegramClient implements TelegramClient {
  readonly sent: { chatId: string; text: string }[] = [];
  /** Errors to throw on the next calls, in order. */
  readonly failures: TelegramApiError[] = [];

  sendMessage(chatId: string, text: string): Promise<void> {
    const failure = this.failures.shift();
    if (failure) {
      return Promise.reject(failure);
    }
    this.sent.push({ chatId, text });
    return Promise.resolve();
  }
}

/** The parts of a Telegram `Update` the webhook uses; everything else is ignored. */
export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      text: z.string().max(4096).optional(),
      chat: z.object({ id: z.number().int(), type: z.string() }),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

/** Link codes are 32 base64url characters; Telegram allows up to 64 in `/start`. */
export function parseStartCommand(text: string | undefined): string | null {
  const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{16,64})$/.exec(text?.trim() ?? '');
  return match ? match[1]! : null;
}

export function isStopCommand(text: string | undefined): boolean {
  return /^\/stop(?:@\w+)?$/.test(text?.trim() ?? '');
}

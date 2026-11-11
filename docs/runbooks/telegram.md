# Runbook: Telegram notifications

Telegram delivery is optional. Without configuration everything else works and the options
page shows "Telegram notifications are not available yet".

## One-time setup (operator)

1. In Telegram, talk to **@BotFather**: `/newbot`, choose a name and a username ending in
   `bot`. BotFather returns the bot token. Treat it like a password: store it only in the
   deployment's secret store, never in git, chat, or tickets.
2. Generate the other secrets:

   ```bash
   # 32-byte encryption key for chat ids (base64)
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   # Webhook secret (Telegram allows A-Z a-z 0-9 _ -)
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

3. Configure the **API**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (without `@`),
   `TELEGRAM_WEBHOOK_SECRET`, `ENCRYPTION_KEY`.
   Configure the **worker**: `TELEGRAM_BOT_TOKEN`, `ENCRYPTION_KEY` (the same key).
4. Register the webhook (HTTPS only). Run it from a trusted shell; the token must not end up
   in shell history on shared machines:

   ```bash
   curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=https://<api-host>/telegram/webhook" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
     -d 'allowed_updates=["message"]' \
     -d "drop_pending_updates=true"
   ```

5. Check: `curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"` shows
   the URL and no `last_error_message`.

## Verify end to end (staging)

1. In the extension: **Notification settings → Link Telegram**. Telegram opens the bot with a
   code; press **Start**. The bot replies "CampusWatch is linked".
2. Trigger a change with fixture data (see `docs/runbooks/staging-e2e.md`); within 30 seconds
   the chat receives a summary message without scores or amounts.
3. **Unlink Telegram** in the options page, or send `/stop` to the bot: no further messages.

## Rotation and incidents

- **Bot token leaked:** revoke it with BotFather (`/revoke`), set the new token on API and
  worker, and run `setWebhook` again.
- **Webhook secret leaked:** set a new `TELEGRAM_WEBHOOK_SECRET` and run `setWebhook` with it.
- **`ENCRYPTION_KEY` rotation:** existing links cannot be decrypted with a new key. Rotate by
  deleting `telegram_links` rows (users re-link) or by re-encrypting offline with both keys.
- **Deliveries stuck in `pending`:** check that the worker is running, `TELEGRAM_BOT_TOKEN`
  is set on it, and Redis is reachable; `notification_deliveries.last_error_code` shows the
  Telegram HTTP status (for example `telegram_429`).

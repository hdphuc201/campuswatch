# Runbook: security incidents and key rotation

## Severity guide

| Severity | Examples                                                             | Target response                    |
| -------- | -------------------------------------------------------------------- | ---------------------------------- |
| SEV1     | Cross-user data exposure; secret in a public place; database exposed | Start within 1 hour, contain first |
| SEV2     | Data leak inside logs/telemetry; authentication bypass suspected     | Same day                           |
| SEV3     | Selector drift; Telegram outage; elevated 5xx                        | Next business day                  |

## First steps for SEV1/SEV2

1. **Contain:** if cross-user exposure is possible, stop the API (or block `/sync-runs`,
   `/changes`, `/entities` at the proxy). Students' extensions back off and queue snapshots.
2. **Preserve evidence:** keep logs and database snapshots; do not edit rows by hand.
3. **Rotate** affected secrets (below).
4. **Assess scope** with aggregate queries; note affected user ids, not their data.
5. **Inform** affected students and the pilot coordinator in plain language; follow the
   university's data-protection requirements.
6. **Fix and add a test** that would have caught it (authorization fuzz table, redaction test).

## Secret rotation

| Secret                                  | Effect of rotation                                                                               | Procedure                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`                           | All access tokens invalid (refresh tokens still work, so users stay signed in after one refresh) | Set new value, restart API                                                                                                                    |
| Refresh/device tokens (suspected theft) | Users sign in again; extensions re-register                                                      | `UPDATE auth_sessions SET revoked_at = now() WHERE revoked_at IS NULL;` and `UPDATE devices SET revoked_at = now() WHERE revoked_at IS NULL;` |
| `TELEGRAM_BOT_TOKEN`                    | None for users                                                                                   | BotFather `/revoke`, set on API + worker, re-run `setWebhook` (`telegram.md`)                                                                 |
| `TELEGRAM_WEBHOOK_SECRET`               | None for users                                                                                   | Set new value, re-run `setWebhook`                                                                                                            |
| `ENCRYPTION_KEY`                        | Existing Telegram links unreadable                                                               | Delete `telegram_links` (users re-link) or re-encrypt offline with both keys                                                                  |
| `OPS_METRICS_TOKEN`                     | Monitoring needs the new token                                                                   | Set new value, update the scraper                                                                                                             |
| Database password                       | Brief downtime                                                                                   | Rotate in the database, update `DATABASE_URL`, restart API, worker, and migrations job                                                        |

## Never

- Never ask a student for their Portal password, cookies, or session values.
- Never copy production data to a laptop or into a ticket.
- Never disable rate limits or the authorization guard to "debug" production.

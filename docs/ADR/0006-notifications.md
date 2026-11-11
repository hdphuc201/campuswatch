# ADR-0006: Chrome and Telegram notifications

- **Status:** Accepted
- **Date:** 2026-11-11
- **Phase:** P6 (implementation plan, sections 10 and 13)

## Decision

### Fan-out in the ingest transaction

When `POST /sync-runs` creates change events, the same transaction inserts one
`notification_deliveries` row per event and enabled channel. A change and its notifications
are committed together, `UNIQUE (change_event_id, channel)` prevents duplicates, and replayed
or concurrent uploads (which create no new events) create no new deliveries.

Policy (`@campuswatch/notifications`):

- Categories: grades, tuition, timetable, exams, notices. Notices notify only when added.
- Grades and tuition are urgent and ignore quiet hours; the others wait until quiet hours
  end (`deliver_after`, computed in the user's IANA time zone, wrapping past midnight).
- Preferences per category × channel, quiet hours, time zone, and detail level per channel
  (`GET/PUT /notification-preferences`). Defaults: everything on, no quiet hours,
  `Asia/Ho_Chi_Minh`, **summary** detail on both channels.
- Batching: each delivery run sends **one message per user** ("3 grade updates, 1 exam
  schedule change"), which is the de-duplication window in practice.

### Message content

`summary` (default) names categories and counts only: no course names, scores, or amounts,
so it is safe on a lock screen or in a chat preview. `detailed` lists each change with
before/after values and is opt-in per channel.

### Chrome

`GET /notifications/pending` (device token) claims the user's due Chrome deliveries for
5 minutes (`FOR UPDATE SKIP LOCKED`) and returns one rendered notification;
`POST /notifications/ack` marks them sent (owner-scoped; other users' ids are ignored).
The extension calls it after every sync run. Unacknowledged claims expire and are retried,
so a notification is not lost if the browser closes, and two browsers of one user do not
both show it. The `notifications` permission is added.

### Telegram

- `POST /telegram/link/start` (user) returns `https://t.me/<bot>?start=<code>`: a 32-character
  one-time code, stored only as a SHA-256 hash, valid for 10 minutes; a new code invalidates
  older unused ones.
- `POST /telegram/webhook` (public) is accepted only with the
  `X-Telegram-Bot-Api-Secret-Token` header matching `TELEGRAM_WEBHOOK_SECRET` (constant-time
  compare). Only private chats are handled. `/start <code>` links; `/stop` unlinks.
- The chat id is stored encrypted with AES-256-GCM (`ENCRYPTION_KEY`, 32 bytes, fresh IV,
  authenticated) plus an HMAC for lookups. It is never logged or returned by the API.
- `DELETE /telegram/link` unlinks and immediately marks pending Telegram deliveries
  `skipped`; the worker re-checks the link before every send.
- The worker's `TelegramDispatcher` runs every 30 s (BullMQ job scheduler), claims due rows
  with `FOR UPDATE SKIP LOCKED`, sends one message per user, retries transient errors after
  1, 5, 15, and 60 minutes (5 attempts), and unlinks chats that blocked the bot (HTTP 403).
- Users never enter a bot token or chat id anywhere.

### Configuration and safe disabled behavior

Telegram is enabled only when `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
`TELEGRAM_WEBHOOK_SECRET`, and `ENCRYPTION_KEY` are all set (API) and
`TELEGRAM_BOT_TOKEN` + `ENCRYPTION_KEY` (worker). A partial configuration fails at startup.
Without it the API reports `available: false`, link start returns 503
`telegram_unavailable`, the webhook rejects every call, no Telegram deliveries are created,
and the worker does not schedule dispatches. Activating a real bot is `BLOCKED_EXTERNAL`
until a bot is created and its webhook registered (see the runbook).

## Consequences

- Delivery status is visible to the user (`GET /notifications`, options page).
- Notification content is rendered on the server for both channels from stored change events,
  so the extension never needs other users' data and the worker never sees Portal pages.

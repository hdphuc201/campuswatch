# ADR-0007: Security, privacy, and reliability controls for the pilot

- **Status:** Accepted
- **Date:** 2026-11-11
- **Phase:** P7 (implementation plan, sections 11, 14, and 15)

## Decision

### Rate limits

A global guard (after authentication) applies fixed-window limits backed by Redis
(`REDIS_URL`, required in production; in-memory per process otherwise). Limits cannot be
disabled in production. Exceeding one returns 429 `rate_limited` with `Retry-After`.

| Route                                                      | Limit                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| `POST /auth/login`                                         | 20 / 15 min per IP and 8 / 15 min per email (hashed key) |
| `POST /auth/register`                                      | 10 / hour per IP                                         |
| `POST /auth/refresh`                                       | 60 / 15 min per IP                                       |
| `POST /portal-connections/:id/probe`                       | 60 / hour per device                                     |
| `POST /sync-runs` (snapshot ingest, including manual sync) | 30 / hour per device                                     |
| `GET /notifications/pending`                               | 120 / hour per device                                    |
| `POST /telegram/link/start`                                | 10 / hour per user                                       |
| `POST /telegram/webhook`                                   | 300 / min per IP                                         |
| `/privacy/*` export and deletion                           | 5 / hour per user                                        |

Manual sync is additionally limited to once per 5 minutes in the extension. Client IPs come
from the socket unless `TRUST_PROXY_HOPS` is set for the deployment's reverse proxies.

### Registration without account discovery

`POST /auth/register` always returns 202 `{ "status": "accepted" }` after the same password
hashing work, whether the email is new or taken; an existing account is never modified. The
extension then signs in; if that fails it shows a neutral message. Login already answers
identically for unknown emails and wrong passwords.

### Logging and errors

- API and worker log one JSON object per line through `@campuswatch/observability`. Every
  message and field is redacted: credential/PII/academic keys are dropped, and JWTs,
  CampusWatch tokens, bearer credentials, bot tokens, emails, long digit runs, grouped money,
  cookies/CSRF/ViewState values, and markup are masked inside strings.
- Request logs contain request id, method, route template, status, and duration only.
- Every error body is `{ statusCode, code, message, requestId }` with a stable code
  (`packages/contracts/src/errors.ts`), including Fastify's own errors. Unexpected errors are
  a generic 500; their redacted message goes to the log only.
- Security headers on every response: `nosniff`, `DENY` framing, `no-referrer`, restrictive
  CSP, `no-store`, and HSTS in production. No CORS headers are sent: the extension calls the
  API with host permissions, and browsers on other origins cannot read responses.

### Privacy

- `POST /privacy/export` (password required) returns all stored user data as JSON, without
  password/token hashes or the Telegram chat id.
- `GET /privacy/consents` lists consent grants and revocations; disconnecting revokes consent.
- `DELETE /privacy/data` (password) deletes connections, entities, change history, sync runs,
  deliveries, Telegram link, and preferences; the account and consent records remain.
- `DELETE /privacy/account` (password) deletes the user row; every user-owned table cascades.
  Integration tests count rows in all user-owned tables before and after, for the deleted user
  and for another user.
- Deletion is synchronous in one transaction. At MVP scale it completes in milliseconds; an
  asynchronous job can replace it if needed.
- Retention (worker, daily 03:17 Asia/Ho_Chi_Minh): change history after
  `RETENTION_HISTORY_DAYS` (365); finished deliveries, sync runs no longer anchoring history,
  and revoked devices after `RETENTION_OPERATIONAL_DAYS` (90); expired sessions after 30 days;
  link codes after 1 day. Baseline detection moved to `portal_connections.synced_sources`
  (migration `0003`) so pruning sync runs never re-baselines a source.

### Verification

- Authorization fuzzing: a test asserts every registered route has an explicit policy, then
  calls every protected route with missing, malformed, forged, and wrong-kind credentials, and
  every resource route with another user's valid credentials.
- Log redaction is asserted on the captured logs of a full flow (registration, sync with
  scores and amounts, refresh, Telegram webhook).
- CI: `pnpm audit --prod --audit-level high`, gitleaks over full history, Dependabot weekly.

### Observability

`GET /ops/metrics` (Prometheus text, bearer `OPS_METRICS_TOKEN`, 404 when unset) exposes only
aggregates: sync runs by status, failed sources by source and error code (selector drift =
`ADAPTER_NEEDS_UPDATE`), connections by health state, undelivered notifications, and the age
of the oldest due delivery. Alert rules are in `docs/runbooks/observability.md`.

## Consequences

- Redis becomes a production dependency of the API.
- Clients must treat 202 from registration as "try signing in".
- Older extension builds that expected tokens from registration are not supported (none were
  released).

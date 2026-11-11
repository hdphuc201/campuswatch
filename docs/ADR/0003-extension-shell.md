# ADR-0003: Extension shell, token ownership, and sync lifecycle

- **Status:** Accepted
- **Date:** 2026-11-11
- **Phase:** P3 (implementation plan, sections 5, 6, and 13)

## Decision

### The background service worker owns all credentials

The popup never calls the API and never sees a token. It sends typed commands
(`src/messaging.ts`) to the background service worker, which validates the sender (own
extension pages only) and the message shape. Reason: refresh tokens are single-use and the
server revokes the whole session when one is presented twice. A single owner with a
single-flight refresh makes that race impossible.

`chrome.storage.local` holds only `session` (CampusWatch access/refresh token), `device`
(device id and token), `connection` (id and status), `sync` (bookkeeping), `outbox`, and
`syncLock`. Tests assert that no other key is written and that nothing resembling a Portal
password, cookie, CSRF token, or HTML is stored.

### Permissions

`storage` and `alarms`, plus host access to `https://portal.citd.edu.vn/*` and the
CampusWatch API origin (`WXT_API_BASE_URL`, default `http://127.0.0.1:3000`). Host access to
the Portal is enough to notice Portal page loads (`tabs.onUpdated` exposes URLs only for
granted hosts), so `tabs` is not requested. `cookies` is never requested. `scripting` and
`notifications` are added by the phases that need them (P4, P6).

### Sync lifecycle (`src/sync/engine.ts`)

- One-shot `chrome.alarms` alarm, re-armed after every run at 30 ± 3 minutes (uniform jitter).
- A per-device lock in storage (5-minute expiry) prevents overlapping runs across alarm,
  manual, and Portal-login triggers, including after a service-worker restart.
- Failures (network, Portal unavailable) retry after 5, 15, then 45 minutes (3 retries in
  about 2 hours), then fall back to the normal interval while the UI shows the error.
- `LOGIN_REQUIRED` stops polling. It restarts when a Portal page finishes loading (at most
  one check every 2 minutes), on manual sync, or on resume.
- Parser drift (`ADAPTER_NEEDS_UPDATE`) keeps the normal cadence: fast retries cannot help.
- A revoked device token stops polling and forgets the device; reconnecting registers again.
- Requests that fail transiently go to an outbox (deduplicated per connection, backoff
  1/5/15/60 minutes, at most 5 attempts or 24 hours).
- Manual "Sync now" is limited to once per 5 minutes per device.
- The popup says "Connected" only after a run actually read the Portal.

### Pause

`POST /portal-connections/:id/pause|resume` (user token). A paused connection ignores probe
reports on the server, so a stale or concurrent device can never un-pause it. Resume returns
the connection to `LOGIN_REQUIRED` until the next successful probe.

## Consequences

- Popup actions depend on the service worker; Chrome wakes it for each message.
- Until P4, the build has no Portal adapter: the popup says Portal reading is unavailable and
  no sync is reported as successful.

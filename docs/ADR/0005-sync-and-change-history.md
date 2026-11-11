# ADR-0005: Snapshot ingest, canonical entities, and change history

- **Status:** Accepted
- **Date:** 2026-11-11
- **Phase:** P5 (implementation plan, sections 7, 8, 9, and 13)

## Decision

### Shared database package

The Drizzle schema, SQL migrations, and migration runner moved from `apps/api` to
`@campuswatch/db` (`packages/db`) so the P6 worker uses the same tables. Migration files are
unchanged; `pnpm db:generate` and `pnpm db:migrate` now run in that package.

### Upload

`POST /sync-runs` (device token) carries one snapshot: `connectionId`, a client-generated
`syncRunId`, `collectedAt`, and per-source results. Each source is either
`{ status: 'ok', entities }` or `{ status: 'error', errorCode, errorDetail }`. The plan lists
`POST /sync-runs` and `/sync-runs/:id/snapshot`; a single call is used because a snapshot is
small and one request keeps retries simple.

Validation (shared Zod contract): strict objects, flat canonical payloads (≤ 64 fields, strings
≤ 4000 characters, no HTML tags), entity types must match their source, no duplicate keys,
≤ 5000 entities per source, error details limited to page/field names, and a 2 MiB body limit.
Raw HTML, request headers, cookies, and tokens are never accepted or stored.

### Processing (one transaction per upload)

1. Lock the connection row (`SELECT … FOR UPDATE`, owner-scoped): concurrent uploads for one
   connection are applied one at a time.
2. If `(connection_id, client_run_id)` already exists, return the stored result
   (`replayed: true`) without reprocessing. Retries are therefore safe.
3. A paused connection rejects uploads with 409 `connection_paused`.
4. For each successful source: re-canonicalize and re-fingerprint on the server (client
   fingerprints are not trusted), diff against the stored entities of that source's types,
   upsert new state, delete removed entities, and insert change events.
5. Failed sources keep their stored data untouched (no false `REMOVED` events).
6. Update connection health (`LOGIN_REQUIRED` > all failed > `ADAPTER_NEEDS_UPDATE` >
   `CONNECTED`) and `last_sync_at`.

Rules:

- **Baseline:** the first successful upload of each source stores data without change events,
  so connecting does not flood the user with "new" items. A source that was successfully
  empty before (for example, no exam schedule yet) is not a baseline: new items are changes.
- **Notices** are never `REMOVED`: Dashboard popups come and go.
- **Idempotency key** per change event: SHA-256 of connection, entity type, external key,
  kind, previous and new fingerprints, and the server sync-run id, with a unique constraint.
  Together with row locking and run replay, each real change yields exactly one event; the
  run id keeps a legitimate "removed, then re-added" sequence from being collapsed.

### History

- `GET /changes?connectionId&entityType&limit&before` (user token): newest first, cursor
  pagination, owner-scoped; another user's connection id returns 404.
- `GET /entities/:type?connectionId` (user token): current state, owner-scoped.
- Change events keep field-level before/after values and the entity payload, which serves as
  the minimal version history (no separate `entity_versions` table in the MVP).
- `sync_runs.source_results` records per-source status, counts, and error codes/details
  (names only) for drift monitoring.

### Extension

After a successful probe the extension collects all five sources (a failing source does not
stop the others; `LOGIN_REQUIRED` stops the run), uploads one snapshot, and queues it in the
outbox if the API is unreachable (only the latest snapshot per connection is kept). The popup
lists the 10 most recent changes in plain language.

## Consequences

- Every new read/write path is owner-scoped and covered by User A/User B tests
  (`apps/api/test/sync.int.test.ts`).
- Retention of `change_events`, `entities`, and `sync_runs` is handled in P7.

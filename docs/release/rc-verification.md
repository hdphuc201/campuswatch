# Release-candidate verification report: 0.1.0-rc.1

- **Date:** 2026-11-11
- **Scope:** implementation plan phases P1–P8
- **Verdict:** software complete for a pilot. **Not yet ready to invite students**: the external
  gates below must be closed first, the most important being the read-only live Portal check.

## Automated evidence (local run on the release commit; CI runs the same commands)

| Check                                                            | Result                                            |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                 | Pass                                              |
| `pnpm lint` (Prettier + type-aware ESLint, all packages)         | Pass                                              |
| `pnpm typecheck` (strict TypeScript, all packages)               | Pass                                              |
| `pnpm test` (unit)                                               | 169 tests pass                                    |
| `pnpm test:integration` (API, worker, E2E against PostgreSQL 16) | 86 tests pass                                     |
| `pnpm build` (packages, API, worker, MV3 extension)              | Pass                                              |
| Migration drift (`pnpm db:generate` produces no changes)         | Pass                                              |
| `pnpm audit --prod --audit-level high`                           | No high or critical advisories                    |
| gitleaks (working tree and full history)                         | No leaks                                          |
| CI on P1–P7 commits                                              | Green (runs listed in `docs/AUTOPILOT_STATUS.md`) |

### Coverage of the plan's acceptance criteria (section 3)

| Criterion                                                   | Evidence                                                                                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| User A cannot read, call, or be notified with User B's data | `isolation`, `sync`, `notifications`, `privacy` suites; authorization fuzzing over every route; E2E                                |
| ~30-minute scans with jitter; add/update/remove detected    | Extension engine tests (30 ± 3 min, retry 5/15/45); sync suite (field-level diffs); E2E                                            |
| No Portal secrets in DB, logs, telemetry, Telegram          | Contract validation rejects markup; redaction tests; persisted-data and log audits in sync, security, and E2E suites               |
| No duplicate notifications on retries or multiple tabs      | Replay by `syncRunId`, row lock, unique idempotency keys; concurrent-upload test → one event; worker `SKIP LOCKED` test → one send |
| Expired session reported, no infinite retries               | Engine stops polling on `LOGIN_REQUIRED`; E2E step 4                                                                               |
| Onboarding states the Chrome-only limit                     | Consent screen test; onboarding guide                                                                                              |

### Release gates (section 15)

| Gate                                                          | Status                        |
| ------------------------------------------------------------- | ----------------------------- |
| Multi-user isolation tests pass                               | Pass                          |
| No Portal password/cookie/CSRF/raw DOM in logs, DB, analytics | Pass (no analytics collected) |
| Consent withdrawal, disconnect, delete data                   | Pass                          |
| `LOGIN_REQUIRED` handling                                     | Pass                          |
| Rate limits, jitter, backoff for the Portal                   | Pass                          |
| Telegram link verifies nonce and webhook secret               | Pass                          |

## Runtime evidence

| Check                                                                                                                                       | Result                        |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Docker images `api`, `worker`, `migrate` build                                                                                              | Pass (314 MB, 310 MB, 262 MB) |
| `migrate` container applies migrations; second run is a no-op                                                                               | Pass                          |
| `check-config` rejects an incomplete production environment, accepts a complete one                                                         | Pass                          |
| API container: `/health/ready` OK, HSTS present, register 202 → login 200, runs as `node`, Docker healthcheck `healthy`                     | Pass                          |
| Worker container: boots, reports Telegram disabled safely, stops on SIGTERM in about 1 s                                                    | Pass                          |
| Rate limiting with Redis: 8 × 401 then 429 with `Retry-After`; only hashed keys in Redis; email absent from logs                            | Pass                          |
| Extension release script: refuses HTTP/localhost; verified manifest (`alarms`, `notifications`, `scripting`, `storage`; Portal + API hosts) | Pass                          |
| Extension controller against the real API (P3 lifecycle check)                                                                              | Pass                          |

## External gates (`BLOCKED_EXTERNAL`)

| Gate                                       | Why it is external                                                                  | Safe behavior until closed                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Live, read-only CITD Portal verification   | Needs a student's own Portal account; no discovery capture exists in the repository | `liveVerified: false`, beta label; mismatches surface as `ADAPTER_NEEDS_UPDATE`, never as false data |
| Staging/production host, DNS, TLS, backups | Needs a hosting account and domain                                                  | Compose stack, images, and runbooks ready                                                            |
| Telegram bot and webhook                   | Needs a BotFather token and a public HTTPS URL                                      | Telegram reported unavailable; no Telegram deliveries                                                |
| Email provider                             | Needed for email verification and password recovery                                 | Accounts work without verification                                                                   |
| Privacy policy completion and approval     | Needs the operator's details and CITD/university review                             | Draft in `docs/pilot/privacy-policy.md`                                                              |
| Chrome Web Store publication               | Needs a developer account and review                                                | Pilot uses Load unpacked with a verified zip                                                         |
| Inviting pilot students                    | Needs the organizers                                                                | Onboarding guide and checklist ready                                                                 |

## Known limitations

- Monitoring only while Chrome runs (by design).
- When the student has no Portal tab open, a background Portal tab appears briefly during sync.
- Deletion is synchronous (fine at pilot scale).
- Rate limits use fixed windows.

# Staging end-to-end test plan

Two levels. Neither creates or changes anything in the real CITD Portal.

## 1. Automated pipeline test (every CI run)

`tests/e2e/src/pipeline.e2e.test.ts` runs in CI (`pnpm test:integration`) against PostgreSQL:

| Step                         | Covers                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Register → consent → connect | Account, device registration, connection, consent record                                                                                   |
| First sync                   | Real CITD collector on fixtures → extension adapter (entity validation) → snapshot upload → baseline (no events)                           |
| Telegram link                | Deep link with one-time code → webhook with secret → encrypted link                                                                        |
| Changed fixtures             | Regrade, new course, new exam schedule → field-level change events → one Chrome notification (summary) → worker sends one Telegram summary |
| Re-sync of the same data     | No duplicate events or notifications                                                                                                       |
| Session expiry               | Login page → `LOGIN_REQUIRED`, polling stops                                                                                               |
| Secrets audit                | Extension storage, database payloads, and logs contain no HTML, cookies, CSRF values, emails, or chat ids                                  |
| Export and account deletion  | All user rows removed; extension storage cleared                                                                                           |

## 2. Manual staging run (before each pilot release)

Use **two non-production test accounts** on CampusWatch staging and fixtures only; real
students' Portal accounts are not used in staging.

| #   | Action                                                                                                                                                                                               | Expected                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | `WXT_API_BASE_URL=https://<staging> pnpm release:extension`; load the zip unpacked in a clean Chrome profile                                                                                         | Manifest verified; popup opens                                                           |
| 2   | Create account A; read consent; connect                                                                                                                                                              | Status "Log in to the CITD Portal" or "Connected"; no Portal password requested anywhere |
| 3   | Without a Portal session, press **Sync now**                                                                                                                                                         | "Log in to the CITD Portal"; no retries until a Portal page loads                        |
| 4   | Point the collector at fixtures: run the automated suite against staging data, or use `pnpm --filter @campuswatch/e2e test:integration` with `TEST_DATABASE_URL` pointing at a staging-like database | All steps pass                                                                           |
| 5   | Settings and data → Link Telegram (if a staging bot exists)                                                                                                                                          | Bot replies "linked"; summary messages arrive; `/stop` unlinks                           |
| 6   | Quiet hours 00:00–23:59, trigger an exam change                                                                                                                                                      | Exam notification waits; grade notification arrives                                      |
| 7   | Account B signs in on another profile                                                                                                                                                                | Sees none of A's data, changes, or notifications                                         |
| 8   | Hit login 9 times with a wrong password                                                                                                                                                              | 429 with "Too many attempts"                                                             |
| 9   | `GET /ops/metrics` from the host                                                                                                                                                                     | Aggregates only; no emails, ids, or scores                                               |
| 10  | Export, Delete my data, Delete my account                                                                                                                                                            | Download works; data gone; account gone; sign-in fails                                   |
| 11  | Check API and worker logs for the whole session                                                                                                                                                      | No emails, tokens, scores, amounts, or HTML                                              |

Record results in the release's verification report.

## Live Portal check (read-only, separate)

Only a student volunteer with their own account, following `docs/runbooks/citd-adapter.md`.
It confirms page paths and column names; it never submits forms or changes data.

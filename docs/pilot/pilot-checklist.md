# Pilot checklist (5–20 students)

Release gates from the implementation plan (section 15) and the work that needs people,
accounts, or approvals outside this repository.

## Engineering gates (verified in this repository)

- [x] Multi-user isolation tests pass (API isolation suites, authorization fuzzing, E2E).
- [x] No Portal password, cookie, CSRF value, or raw DOM reaches the database, logs, or
      Telegram (validation, redaction, and E2E audit tests).
- [x] Consent withdrawal (disconnect), data deletion, and account deletion exist and are tested.
- [x] `LOGIN_REQUIRED` handling: polling stops and resumes after a new Portal login.
- [x] Rate limits, jitter, and backoff for Portal access and the API.
- [x] Telegram linking verifies a one-time code and the webhook secret.
- [x] CI green: lint, typecheck, unit, integration, E2E, build, migration drift, dependency
      audit, secret scan.

## Before inviting students (external)

- [ ] **Live Portal check:** a volunteer verifies page paths and columns read-only with their
      own account (`docs/runbooks/citd-adapter.md`); set `liveVerified` when done.
- [ ] **Staging host:** provision a host and DNS name; deploy with
      `docs/runbooks/deployment.md`; run `docs/runbooks/staging-e2e.md`.
- [ ] **Backups:** automated encrypted database backups with a tested restore.
- [ ] **Monitoring:** scrape `/ops/metrics`; configure the alerts in `observability.md`.
- [ ] **Telegram (optional):** create the bot, set secrets, register the webhook (`telegram.md`).
- [ ] **Privacy policy:** complete the bracketed items in `docs/pilot/privacy-policy.md`; review
      with the organizers / data-protection contact; publish where students can read it.
- [ ] **Approval:** confirm the pilot is acceptable to CITD / the university as required.
- [ ] **Support:** set up the support channel and on-call person (`support.md`).
- [ ] **Package:** `WXT_API_BASE_URL=https://<api> pnpm release:extension`; record the SHA-256.

## During the pilot (2 weeks, plan section 13 P8)

- [ ] Onboard students with `docs/pilot/onboarding.md`.
- [ ] Weekly review of metrics: sync success ≥ 95 % while the Portal is healthy; duplicate
      notifications < 1 %; 0 cross-user incidents; 0 sensitive-log incidents; drift detected and
      shown in 100 % of known breaks.
- [ ] Collect feedback; triage parser drift within one school day.

## Exit

- [ ] Go/no-go for a wider release, recorded as an ADR.
- [ ] Students told how their data will be kept or deleted after the pilot.

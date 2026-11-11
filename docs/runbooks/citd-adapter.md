# Runbook: CITD adapter verification and drift

## Live read-only verification (before the pilot)

The collectors were built from synthetic fixtures (`packages/citd-adapter/fixtures`). Before
the pilot, a student volunteer verifies them with **their own** Portal account. Never ask for
or share a Portal password, and never automate the login.

1. Log in to the CITD Portal in Chrome as usual.
2. For each page (Dashboard, grades, tuition, timetable, exams), note the URL path and compare
   it with `CITD_PAGE_PATHS` in `packages/citd-adapter/src/profile.ts`.
3. Save the page (Ctrl+S, "Webpage, HTML only") to a folder **outside** the repository.
4. Redact every personal value: name, student ID, date of birth, email, phone, grades, amounts,
   class codes if identifying. Replace them with invented values of the same format
   (`8,5` stays a decimal with a comma; `9.800.000` keeps dot separators).
5. Remove `<script>` tags, hidden form fields (`__VIEWSTATE`, `__RequestVerificationToken`,
   CSRF tokens), and anything that looks like a session identifier.
6. Copy the redacted file into `packages/citd-adapter/fixtures/` with a
   `<!-- REDACTED CAPTURE: … -->` comment, add a test in
   `packages/citd-adapter/src/parsers/parsers.test.ts`, and fix aliases or paths until it
   passes. Run `pnpm --filter @campuswatch/citd-adapter test`.
7. Load the extension unpacked, connect, and press **Sync now**. Confirm the popup shows
   **Connected** and not "CampusWatch needs an update".
8. When all five sources pass, set `liveVerified: true` in
   `packages/portal-core/src/citd.ts` and update `docs/AUTOPILOT_STATUS.md`.

Scan captures with gitleaks before committing them (for example
`docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 dir /repo/packages/citd-adapter/fixtures`);
CI also scans the full history.

## Responding to `ADAPTER_NEEDS_UPDATE`

1. The popup shows "CampusWatch needs an update". The failing page and field (names only,
   never values) are recorded with the sync run on the server (`sync_runs.source_results`).
2. Reproduce with a newly redacted capture of the affected page (steps above).
3. Prefer adding a header alias or marker over changing parsing logic. Keep every old fixture
   passing so older layouts keep working.
4. Ship a new extension version. Students keep their history: external keys do not change
   when only aliases change.

## Safety rules

- Read-only: the collector issues `GET` requests to the Portal origin only
  (`runCollector` refuses cross-origin paths) and never submits forms.
- Never commit unredacted pages, cookies, tokens, `__VIEWSTATE`, or screenshots with personal
  data.
- Never add the `cookies` permission or broaden host permissions to fix a collector.

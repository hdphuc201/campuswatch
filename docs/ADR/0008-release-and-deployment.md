# ADR-0008: Release packaging and deployment shape for the pilot

- **Status:** Accepted
- **Date:** 2026-11-11
- **Phase:** P8 (implementation plan, section 13)

## Decision

- **Backend images:** one multi-target Dockerfile (`infra/docker/Dockerfile`) produces `api`,
  `worker`, and `migrate` images from a single build stage. `pnpm deploy --prod` creates
  self-contained bundles with only production dependencies; images run as the unprivileged
  `node` user under `tini`, with no secrets baked in.
- **Migrations** run as a one-shot `migrate` container before the API and worker start (compose
  `service_completed_successfully`). They are additive within a release so the previous version
  can run against a newer schema during rollback.
- **Staging stack:** Docker Compose with PostgreSQL 16, Redis 7, API, worker, migrations, and
  Caddy for automatic HTTPS. `/ops/*` is not exposed publicly. This keeps the pilot on one
  modest host; the same images run on any container platform later (plan section 4: hosting can
  change without changing contracts).
- **Configuration preflight:** `dist/check-config.js` in API and worker validates the
  environment and reports enabled features without printing values.
- **Extension packaging:** `pnpm release:extension` requires an HTTPS, non-localhost API URL,
  builds the zip with WXT, verifies the manifest permissions and hosts, and prints a SHA-256.
  Versions come from `package.json` (0.1.0 for this release candidate).
- **End-to-end verification:** `tests/e2e` runs the real collector, extension engine, API,
  notification fan-out, and worker dispatcher together against PostgreSQL in CI.

## Not done here (external)

Provisioning a host, DNS, certificates, backups, a Telegram bot, Chrome Web Store publication,
and inviting pilot students require accounts and approvals outside the repository; they are
listed in `docs/pilot/pilot-checklist.md` and `docs/AUTOPILOT_STATUS.md`.

# CampusWatch

CampusWatch notifies students when their CITD Portal academic data changes: grades, tuition,
timetable, exams, and Dashboard notices. A Chrome Extension reads the student's own logged-in
Portal session; a shared Backend stores history and sends Chrome and Telegram notifications.

The Backend never stores Portal passwords, cookies, or CSRF tokens, and monitoring only runs
while Chrome is running. See [ADR-0001](docs/ADR/0001-extension-first.md) and the
[implementation plan](docs/CAMPUSWATCH_OFFICIAL_IMPLEMENTATION_PLAN.md).

> **Status: 0.1.0-rc.1, pilot release candidate.** Phase progress and external gates:
> [docs/AUTOPILOT_STATUS.md](docs/AUTOPILOT_STATUS.md). Release notes:
> [docs/release/0.1.0-rc.1.md](docs/release/0.1.0-rc.1.md). Decisions: [docs/ADR](docs/ADR).

## Repository layout

| Path                     | Purpose                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| `apps/extension`         | Chrome Extension: WXT, React, TypeScript, Manifest V3                           |
| `apps/api`               | HTTP API: NestJS on Fastify                                                     |
| `apps/worker`            | Background worker: NestJS and BullMQ (Telegram delivery, retention)             |
| `packages/contracts`     | Shared Zod schemas and DTO types                                                |
| `packages/citd-adapter`  | Read-only CITD Portal collectors (page profile, parsers, normalization)         |
| `packages/portal-core`   | Portal adapter contract, CITD capabilities, fingerprint, diff                   |
| `packages/db`            | PostgreSQL schema (Drizzle), SQL migrations, migration runner                   |
| `packages/notifications` | Notification policy, rendering, quiet hours; Telegram client and encryption     |
| `packages/observability` | Redacted JSON logging                                                           |
| `packages/config`        | Shared TypeScript, ESLint, and Prettier configuration                           |
| `tests/e2e`              | End-to-end pipeline test (collector → extension → API → notifications → worker) |
| `infra`                  | Local Docker Compose, container images, staging deployment                      |
| `docs`                   | ADRs, runbooks, pilot documents, release notes                                  |

## Prerequisites

- Node.js 22 LTS (22.13 or newer; see `.nvmrc`)
- pnpm 10 (`corepack enable` picks up the pinned version)
- Docker with Compose v2
- Google Chrome

## Setup

```bash
pnpm install
pnpm infra:up        # PostgreSQL 16 + Redis 7, waits until healthy
pnpm db:migrate      # applies database migrations
pnpm dev             # API, worker, and extension in watch mode
```

Copy `.env.example` to `.env` only if you need to override defaults (for example, ports that
are already in use). Details: [local development runbook](docs/runbooks/local-development.md).

Stop the infrastructure with `pnpm infra:down`.

## Checks

```bash
pnpm lint               # Prettier check + type-aware ESLint
pnpm typecheck          # strict TypeScript
pnpm test               # unit tests
pnpm test:integration   # API, worker, and E2E against PostgreSQL (needs infra:up)
pnpm build
pnpm config:check       # validate API/worker environment without starting them
```

CI (`.github/workflows/ci.yml`) runs these on Node.js 22 with a frozen lockfile, checks that
database migrations match the schema, runs the integration and E2E tests against PostgreSQL 16,
audits production dependencies, and scans the full git history for secrets with gitleaks.

## Load the extension in Chrome

1. `pnpm --filter @campuswatch/extension build`
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select `apps/extension/.output/chrome-mv3`.
4. Open the CampusWatch popup, create a CampusWatch account, accept the consent screen,
   and connect. Details: [runbook](docs/runbooks/local-development.md#loading-the-extension-in-chrome).

Pilot packages: `WXT_API_BASE_URL=https://<api> pnpm release:extension`
([deployment runbook](docs/runbooks/deployment.md)).

## Documentation

- Runbooks: [local development](docs/runbooks/local-development.md),
  [deployment](docs/runbooks/deployment.md), [rollback](docs/runbooks/rollback.md),
  [staging E2E](docs/runbooks/staging-e2e.md), [CITD adapter](docs/runbooks/citd-adapter.md),
  [Telegram](docs/runbooks/telegram.md), [observability](docs/runbooks/observability.md),
  [incident response](docs/runbooks/incident-response.md),
  [privacy requests](docs/runbooks/privacy-requests.md), [support](docs/runbooks/support.md).
- Pilot: [onboarding](docs/pilot/onboarding.md), [privacy policy draft](docs/pilot/privacy-policy.md),
  [checklist](docs/pilot/pilot-checklist.md).

## Security rules

- Never commit `.env`, `*.env`, credentials, browser profiles, local databases, or logs with
  sensitive values.
- Never add Portal passwords, cookies, CSRF tokens, or raw Portal HTML to the Backend, logs,
  fixtures, or tests. Fixtures are synthetic or redacted.
- Portal access is read-only. No automated login and no requests that change Portal data.

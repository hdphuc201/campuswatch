# CampusWatch

CampusWatch notifies students when their CITD Portal academic data changes: grades, tuition,
timetable, exams, and dashboard notices. A Chrome Extension reads the student's own logged-in
Portal session; a shared Backend stores history and sends notifications.

The Backend never stores Portal passwords, cookies, or CSRF tokens, and monitoring only runs
while Chrome is running. See [ADR-0001](docs/ADR/0001-extension-first.md) and the
[implementation plan](docs/CAMPUSWATCH_OFFICIAL_IMPLEMENTATION_PLAN.md).

> **Status:** see [docs/AUTOPILOT_STATUS.md](docs/AUTOPILOT_STATUS.md) for phase progress.
> Architecture decisions are in [docs/ADR](docs/ADR).

## Repository layout

| Path                    | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `apps/extension`        | Chrome Extension: WXT, React, TypeScript, Manifest V3                   |
| `apps/api`              | HTTP API: NestJS on Fastify, PostgreSQL via Drizzle                     |
| `apps/worker`           | Background worker: NestJS and BullMQ                                    |
| `packages/contracts`    | Shared Zod schemas and DTO types                                        |
| `packages/citd-adapter` | Read-only CITD Portal collectors (page profile, parsers, normalization) |
| `packages/portal-core`  | Read-only Portal adapter contract, CITD capabilities, fingerprint, diff |
| `packages/config`       | Shared TypeScript, ESLint, and Prettier configuration                   |
| `infra`                 | Docker Compose for local PostgreSQL 16 and Redis 7                      |
| `docs`                  | ADRs and runbooks                                                       |

## Prerequisites

- Node.js 22 LTS (22.13 or newer; see `.nvmrc`)
- pnpm 10 (`corepack enable` picks up the pinned version)
- Docker with Compose v2
- Google Chrome

## Setup

```bash
pnpm install
pnpm infra:up        # PostgreSQL 16 + Redis 7, waits until healthy
pnpm db:migrate      # builds the API and applies database migrations
pnpm dev             # API, worker, and extension in watch mode
```

Copy `.env.example` to `.env` only if you need to override defaults (for example, ports that
are already in use). Details: [local development runbook](docs/runbooks/local-development.md).

Stop the infrastructure with `pnpm infra:down`.

## Checks

```bash
pnpm lint               # Prettier check + type-aware ESLint
pnpm typecheck          # strict TypeScript
pnpm test               # Vitest unit tests
pnpm test:integration   # API against PostgreSQL, incl. User A/B isolation (needs infra:up)
pnpm build
```

CI (`.github/workflows/ci.yml`) runs these on Node.js 22 with a frozen lockfile, checks that
database migrations match the schema, runs the integration tests against PostgreSQL 16, and
scans the full git history for secrets with gitleaks.

## Load the extension in Chrome

1. `pnpm --filter @campuswatch/extension build`
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select `apps/extension/.output/chrome-mv3`.
4. Open the CampusWatch popup, create a CampusWatch account, accept the consent screen,
   and connect. Details: [runbook](docs/runbooks/local-development.md#loading-the-extension-in-chrome).

## Security rules

- Never commit `.env`, credentials, browser profiles, local databases, or logs with
  sensitive values.
- Never add Portal passwords, cookies, CSRF tokens, or raw Portal HTML to the Backend,
  logs, fixtures, or tests.
- Portal access is read-only. No automated login and no requests that change Portal data.

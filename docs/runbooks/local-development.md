# Local development runbook

## Prerequisites

| Tool                      | Version                                                 |
| ------------------------- | ------------------------------------------------------- |
| Node.js                   | 22 LTS, 22.13 or newer (`.nvmrc`)                       |
| pnpm                      | 10 (pinned in `package.json` → `packageManager`)        |
| Docker with Compose v2    | Any recent version (Docker Desktop on Windows or macOS) |
| Google Chrome or Chromium | Current stable, for the extension                       |

Enable the pinned pnpm with `corepack enable`, or install pnpm 10 directly.

## First-time setup

```bash
pnpm install
cp .env.example .env   # optional; every variable has a local default
pnpm infra:up
pnpm db:migrate        # builds the API, then applies SQL migrations
```

`pnpm install` also runs `wxt prepare` for the extension, which generates
`apps/extension/.wxt/` (TypeScript types; not committed).

## Environment variables

All variables are optional for local development. Empty values count as unset.
`.env` is read from the repository root by Docker Compose and by the `dev`/`start` scripts
of the API and worker. Never put CITD Portal credentials in `.env`.

| Variable                   | Used by           | Local default                       | Notes                                                                                                                       |
| -------------------------- | ----------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                 | API, worker       | `development`                       | `development`, `test`, or `production`.                                                                                     |
| `LOG_LEVEL`                | API, worker       | `log`                               | `fatal`, `error`, `warn`, `log`, `debug`, `verbose`.                                                                        |
| `API_HOST`                 | API               | `127.0.0.1`                         | Use `0.0.0.0` inside containers.                                                                                            |
| `API_PORT`                 | API               | `3000`                              |                                                                                                                             |
| `DATABASE_URL`             | API, `db:migrate` | compose database (below)            | Required in production.                                                                                                     |
| `DATABASE_POOL_MAX`        | API               | `10`                                |                                                                                                                             |
| `AUTH_SECRET`              | API               | random per process                  | Signs access tokens; at least 32 characters. Required in production. Without it, tokens stop working when the API restarts. |
| `ACCESS_TOKEN_TTL_SECONDS` | API               | `900`                               | 60 to 3600.                                                                                                                 |
| `REFRESH_TOKEN_TTL_DAYS`   | API               | `30`                                | 1 to 90.                                                                                                                    |
| `REDIS_URL`                | Worker            | `redis://127.0.0.1:6379`            | Required in production.                                                                                                     |
| `TEST_DATABASE_URL`        | Integration tests | compose server, `postgres` database | Needs permission to create databases.                                                                                       |
| `POSTGRES_PORT`            | Compose           | `5432`                              | Host port, bound to 127.0.0.1 only.                                                                                         |
| `POSTGRES_USER`            | Compose           | `campuswatch`                       |                                                                                                                             |
| `POSTGRES_PASSWORD`        | Compose           | `campuswatch_local`                 | Local-only value.                                                                                                           |
| `POSTGRES_DB`              | Compose           | `campuswatch`                       |                                                                                                                             |
| `REDIS_PORT`               | Compose           | `6379`                              | Host port, bound to 127.0.0.1 only.                                                                                         |

## Local infrastructure

```bash
pnpm infra:up     # starts PostgreSQL 16 and Redis 7, waits until both are healthy
pnpm infra:down   # stops containers and keeps data volumes
```

Data lives in the named volumes `campuswatch_postgres-data` and `campuswatch_redis-data`.
To wipe local data:

```bash
docker compose --project-directory . -f infra/docker-compose.yml down -v
```

Connection strings with the defaults:

```text
postgresql://campuswatch:campuswatch_local@127.0.0.1:5432/campuswatch
redis://127.0.0.1:6379
```

**Port already in use?** Another project may already use 5432 or 6379. Set
`POSTGRES_PORT` / `REDIS_PORT` in `.env` (for example `REDIS_PORT=6390`) and point the
matching URLs at the same port (`REDIS_URL=redis://127.0.0.1:6390`; for Postgres, both
`DATABASE_URL` and `TEST_DATABASE_URL`).

## Database migrations

The schema lives in `apps/api/src/database/schema.ts`; SQL migrations generated from it are
committed in `apps/api/drizzle/`.

```bash
pnpm db:generate   # after editing schema.ts: writes a new SQL migration (no database needed)
pnpm db:migrate    # applies pending migrations to DATABASE_URL
```

Review every generated SQL file before committing it. CI fails if `schema.ts` and the
committed migrations are out of sync. Migrations are never applied automatically at API
startup.

## Running the apps

```bash
pnpm dev
```

This builds the shared packages, then runs in watch mode:

- **API** on `http://127.0.0.1:3000`. `curl http://127.0.0.1:3000/health` checks the
  process; `/health/ready` also checks the database. Endpoints are listed in
  [ADR-0002](../ADR/0002-identity-and-isolation.md).
- **Worker**, connected to Redis. It stops with an error if its configuration is invalid
  and closes its Redis connections on Ctrl+C.
- **Extension** dev build with hot reload (WXT dev server on port 3100). Load
  `apps/extension/.output/chrome-mv3-dev` as an unpacked extension once (steps below);
  WXT then reloads it on every change.

Run one app with a filter, for example `pnpm --filter @campuswatch/api dev`.

## Checks

```bash
pnpm lint               # Prettier check + ESLint (type-aware) in every package
pnpm typecheck          # tsc --noEmit in every package
pnpm test               # Vitest unit tests (no services needed)
pnpm test:integration   # API against PostgreSQL; needs `pnpm infra:up`
pnpm build              # production builds
pnpm format             # rewrite files with Prettier
```

Integration tests create a throwaway database per test file (`campuswatch_test_*`), apply
the committed migrations, and drop it afterwards. They include the User A/User B isolation
suite (`apps/api/test/isolation.int.test.ts`).

CI runs lint, typecheck, unit tests, build, a migration drift check, the integration tests
against a PostgreSQL 16 service, and a gitleaks scan of the full git history.

## Loading the extension in Chrome

1. Start the API (`pnpm dev`, or `pnpm --filter @campuswatch/api dev`) with migrations
   applied. Set `AUTH_SECRET` in `.env` so sessions survive API restarts.
2. Build the extension: `pnpm --filter @campuswatch/extension build`. It talks to
   `WXT_API_BASE_URL` (default `http://127.0.0.1:3000`), fixed at build time; for another
   API run `WXT_API_BASE_URL=https://api.example.edu pnpm --filter @campuswatch/extension build`.
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and
   select `apps/extension/.output/chrome-mv3` (or `.output/chrome-mv3-dev` while
   `pnpm dev` is running; WXT reloads it on every change).
4. Open the CampusWatch popup, create a CampusWatch account (not your Portal password),
   accept the consent screen, and connect.
5. Debug the background service worker from `chrome://extensions` → CampusWatch →
   **Service worker** → Inspect. `chrome.storage.local` is visible under Application →
   Storage; it must only contain the keys listed in ADR-0003.

The extension requests `storage` and `alarms` plus host access to the CITD Portal and the
API origin. See [ADR-0003](../ADR/0003-extension-shell.md) for the sync lifecycle.

## Troubleshooting

- **`Cannot find module '@campuswatch/contracts'`**: shared packages are consumed from
  `dist/`. Run `pnpm build` (Turborepo builds dependencies first for every task).
- **Extension typecheck fails with a missing `.wxt/tsconfig.json`**: run
  `pnpm --filter @campuswatch/extension exec wxt prepare`.
- **Worker logs Redis connection errors**: run `pnpm infra:up` and check that `REDIS_URL`
  matches `REDIS_PORT`.
- **API returns 401 after a restart**: without `AUTH_SECRET` the API signs tokens with a
  random per-process secret. Set `AUTH_SECRET` in `.env` to keep sessions across restarts.
- **`/health/ready` returns 503 or API queries fail with "relation does not exist"**: run
  `pnpm infra:up` and `pnpm db:migrate`.

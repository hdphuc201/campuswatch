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
pnpm build
```

`pnpm install` also runs `wxt prepare` for the extension, which generates
`apps/extension/.wxt/` (TypeScript types; not committed).

## Environment variables

All variables are optional for local development. Empty values count as unset.
`.env` is read from the repository root by Docker Compose and by the `dev`/`start` scripts
of the API and worker. Never put CITD Portal credentials in `.env`.

| Variable            | Used by     | Local default            | Notes                                                |
| ------------------- | ----------- | ------------------------ | ---------------------------------------------------- |
| `NODE_ENV`          | API, worker | `development`            | `development`, `test`, or `production`.              |
| `LOG_LEVEL`         | API, worker | `log`                    | `fatal`, `error`, `warn`, `log`, `debug`, `verbose`. |
| `API_HOST`          | API         | `127.0.0.1`              | Use `0.0.0.0` inside containers.                     |
| `API_PORT`          | API         | `3000`                   |                                                      |
| `REDIS_URL`         | Worker      | `redis://127.0.0.1:6379` | Required when `NODE_ENV=production`.                 |
| `POSTGRES_PORT`     | Compose     | `5432`                   | Host port, bound to 127.0.0.1 only.                  |
| `POSTGRES_USER`     | Compose     | `campuswatch`            |                                                      |
| `POSTGRES_PASSWORD` | Compose     | `campuswatch_local`      | Local-only value.                                    |
| `POSTGRES_DB`       | Compose     | `campuswatch`            |                                                      |
| `REDIS_PORT`        | Compose     | `6379`                   | Host port, bound to 127.0.0.1 only.                  |
| `DATABASE_URL`      | (P2)        | none                     | Not read yet; reserved for P2.                       |

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
`POSTGRES_PORT` / `REDIS_PORT` in `.env` (for example `REDIS_PORT=6390`) and point
`REDIS_URL` at the same port (`REDIS_URL=redis://127.0.0.1:6390`).

## Running the apps

```bash
pnpm dev
```

This builds the shared packages, then runs in watch mode:

- **API** on `http://127.0.0.1:3000`. Check it with `curl http://127.0.0.1:3000/health`.
- **Worker**, connected to Redis. It stops with an error if its configuration is invalid
  and closes its Redis connections on Ctrl+C.
- **Extension** dev build with hot reload (WXT dev server on port 3100). Load
  `apps/extension/.output/chrome-mv3-dev` as an unpacked extension once (steps below);
  WXT then reloads it on every change.

Run one app with a filter, for example `pnpm --filter @campuswatch/api dev`.

## Checks

```bash
pnpm lint        # Prettier check + ESLint (type-aware) in every package
pnpm typecheck   # tsc --noEmit in every package
pnpm test        # Vitest unit tests
pnpm build       # production builds
pnpm format      # rewrite files with Prettier
```

CI runs the same four checks on Node.js 22 plus a gitleaks scan of the full git history.

## Loading the extension in Chrome

1. `pnpm --filter @campuswatch/extension build`
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select `apps/extension/.output/chrome-mv3`.
4. Click the CampusWatch toolbar icon. The popup shows **CampusWatch foundation ready**.

The P1 extension requests no permissions and makes no network requests.

## Troubleshooting

- **`Cannot find module '@campuswatch/contracts'`**: shared packages are consumed from
  `dist/`. Run `pnpm build` (Turborepo builds dependencies first for every task).
- **Extension typecheck fails with a missing `.wxt/tsconfig.json`**: run
  `pnpm --filter @campuswatch/extension exec wxt prepare`.
- **Worker logs Redis connection errors**: run `pnpm infra:up` and check that `REDIS_URL`
  matches `REDIS_PORT`.

# Runbook: staging and pilot deployment

CampusWatch ships as three container images built from `infra/docker/Dockerfile`
(`api`, `worker`, `migrate`) plus the Chrome Extension package. Nothing in the images is
secret; configuration comes from the environment.

> Status: deployment configuration is ready and the images build and run locally. An actual
> staging/production host, DNS name, and TLS certificate are external prerequisites
> (`BLOCKED_EXTERNAL` in `docs/AUTOPILOT_STATUS.md`).

## Requirements

- A Linux host with Docker Engine and Compose v2 (2 vCPU, 2 GB RAM is plenty for the pilot).
- A DNS name for the API pointing to the host (ports 80/443 open for Caddy's certificates).
- Off-host backups for the PostgreSQL volume (provider snapshot or `pg_dump` cron), encrypted.

## First deployment (staging)

1. Clone the repository on the host at the release tag (for example `v0.1.0-rc.1`).
2. `cp infra/deploy/staging.env.example infra/deploy/staging.env` and fill in every value
   (generate secrets with the command in that file). `staging.env` is git-ignored; keep it
   readable only by the deploy user (`chmod 600`).
3. Preflight the configuration without starting anything:

   ```bash
   docker compose -f infra/deploy/docker-compose.staging.yml --env-file infra/deploy/staging.env build
   docker compose -f infra/deploy/docker-compose.staging.yml --env-file infra/deploy/staging.env \
     run --rm api node dist/check-config.js
   docker compose -f infra/deploy/docker-compose.staging.yml --env-file infra/deploy/staging.env \
     run --rm worker node dist/check-config.js
   ```

4. Start: `docker compose -f infra/deploy/docker-compose.staging.yml --env-file infra/deploy/staging.env up -d`.
   `migrate` runs first and must exit 0; `api` and `worker` start afterwards.
5. Verify:
   - `curl -fsS https://$API_DOMAIN/health/ready` → `{"status":"ok",…}`
   - `docker compose … logs api worker` shows JSON lines and no errors.
   - `/ops/metrics` is blocked publicly (404 at Caddy); scrape it from the host:
     `docker compose … exec api wget -qO- --header "Authorization: Bearer $OPS_METRICS_TOKEN" http://127.0.0.1:3000/ops/metrics`.
6. Optional Telegram: follow `docs/runbooks/telegram.md` (webhook URL
   `https://$API_DOMAIN/telegram/webhook`).
7. Package the extension for this API (next section) and run the staging test plan
   (`docs/runbooks/staging-e2e.md`).

## Extension package

```bash
WXT_API_BASE_URL=https://$API_DOMAIN pnpm release:extension
```

The script refuses non-HTTPS or localhost URLs, builds `apps/extension/.output/*-chrome.zip`,
and verifies the manifest (version, exactly `alarms`, `notifications`, `scripting`,
`storage`, and host access to the Portal and the API only). Record the printed SHA-256 in the
release notes. For the pilot, distribute the zip to students for **Load unpacked** (see
`docs/pilot/onboarding.md`); Chrome Web Store publication is a separate, external step.

Bump `version` in `apps/extension/package.json` (and the API/worker `package.json`) for every
release; Chrome updates unpacked extensions only when students load the new folder.

## Updates

1. `git fetch && git checkout <new tag>`
2. Back up the database (below).
3. `docker compose … build && docker compose … up -d` (migrations run automatically first).
4. Verify as in step 5. If anything fails, follow `rollback.md`.

## Backups

```bash
docker compose -f infra/deploy/docker-compose.staging.yml --env-file infra/deploy/staging.env \
  exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > campuswatch-$(date +%F).dump
```

Store dumps encrypted and off-host; keep them no longer than the documented backup retention
(privacy policy). Test a restore before the pilot starts.

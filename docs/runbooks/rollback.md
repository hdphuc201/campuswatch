# Runbook: rollback

## Decide

Roll back when a release causes cross-user exposure (also follow `incident-response.md`),
broken sign-in or sync for most students, or sustained 5xx errors. For a parser problem
(`ADAPTER_NEEDS_UPDATE`) prefer a forward fix: the backend keeps working and students see a
clear status.

## Backend

1. Note the current and previous tags (`git describe --tags`).
2. Check whether the release added migrations (`packages/db/drizzle/meta/_journal.json`).
   - **No new migrations:** check out the previous tag and redeploy:
     `docker compose -f infra/deploy/docker-compose.staging.yml --env-file infra/deploy/staging.env up -d --build`.
   - **New migrations:** migrations are additive by policy (new tables/columns, no drops in the
     same release), so the previous API version runs against the newer schema. Redeploy the
     previous tag as above; do not run down-migrations. If a migration itself is faulty,
     restore the pre-deployment backup (`deployment.md` → Backups) into a new database,
     point `DATABASE_URL` at it, and redeploy the previous tag. Changes students synced after
     the backup are recreated by their next sync (current state is re-sent every run).
3. Verify `/health/ready`, logs, and metrics.

## Extension

1. Redistribute the previous release zip (keep every released zip and its SHA-256).
2. Students replace the folder and click **Reload** on `chrome://extensions`. Their
   CampusWatch session, device, and connection remain (stored in `chrome.storage`).
3. A newer extension talking to an older API: endpoints are additive; if a release removed or
   changed one, roll back the extension first.

## Communicate

Tell pilot students what happened, whether any action is needed (usually none), and when the
fix is expected. Never ask them for Portal credentials.

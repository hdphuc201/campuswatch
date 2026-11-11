ALTER TABLE "portal_connections" ADD COLUMN "synced_sources" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Hand-written backfill (not generated): sources that already synced successfully.
UPDATE "portal_connections" AS pc SET "synced_sources" = COALESCE((SELECT array_agg(DISTINCT r->>'source') FROM "sync_runs" AS s, jsonb_array_elements(s."source_results") AS r WHERE s."connection_id" = pc."id" AND r->>'status' = 'ok'), '{}'::text[]);

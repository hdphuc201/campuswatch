CREATE TABLE "change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"external_key" text NOT NULL,
	"kind" text NOT NULL,
	"changed_fields" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"previous_fingerprint" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_events_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "change_events_kind_valid" CHECK ("change_events"."kind" in ('ADDED', 'UPDATED', 'REMOVED'))
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"external_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_connection_type_key_unique" UNIQUE("connection_id","entity_type","external_key"),
	CONSTRAINT "entities_type_valid" CHECK ("entities"."entity_type" in ('grade_course', 'grade_summary', 'tuition_term', 'tuition_course', 'timetable_class', 'exam', 'portal_notice'))
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"client_run_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source_results" jsonb NOT NULL,
	"entity_count" integer NOT NULL,
	"change_count" integer NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_runs_connection_client_run_unique" UNIQUE("connection_id","client_run_id"),
	CONSTRAINT "sync_runs_status_valid" CHECK ("sync_runs"."status" in ('completed', 'partial', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_connection_id_portal_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."portal_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_connection_id_portal_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."portal_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_portal_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."portal_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_events_user_created_idx" ON "change_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "change_events_connection_created_idx" ON "change_events" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE INDEX "entities_user_id_idx" ON "entities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sync_runs_user_id_idx" ON "sync_runs" USING btree ("user_id");
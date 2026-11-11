CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"change_event_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"category" text NOT NULL,
	"urgent" boolean NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"deliver_after" timestamp with time zone NOT NULL,
	"claimed_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_event_channel_unique" UNIQUE("change_event_id","channel"),
	CONSTRAINT "notification_deliveries_status_valid" CHECK ("notification_deliveries"."status" in ('pending', 'sending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "notification_deliveries_channel_valid" CHECK ("notification_deliveries"."channel" in ('chrome', 'telegram'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_link_nonces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"nonce_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_link_nonces_nonce_hash_unique" UNIQUE("nonce_hash")
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"chat_id_encrypted" text NOT NULL,
	"chat_id_hash" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_change_event_id_change_events_id_fk" FOREIGN KEY ("change_event_id") REFERENCES "public"."change_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_nonces" ADD CONSTRAINT "telegram_link_nonces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("channel","status","deliver_after");--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_idx" ON "notification_deliveries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "telegram_link_nonces_user_idx" ON "telegram_link_nonces" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telegram_links_chat_id_hash_idx" ON "telegram_links" USING btree ("chat_id_hash");
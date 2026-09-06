CREATE TABLE "app_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"label" varchar(255) NOT NULL,
	"meta" jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"type" varchar(40) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_events_app_id_occurred_at_index" ON "app_events" USING btree ("app_id","occurred_at");
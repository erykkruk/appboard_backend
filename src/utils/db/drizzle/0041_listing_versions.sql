CREATE TABLE "listing_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"first_seen_at" timestamp NOT NULL,
	"inferred" boolean DEFAULT false NOT NULL,
	"keywords" text,
	"language" varchar(20),
	"last_seen_at" timestamp NOT NULL,
	"subtitle" varchar(255),
	"title" varchar(255),
	"version_released_at" timestamp,
	"version_string" varchar(50)
);
--> statement-breakpoint
ALTER TABLE "rank_snapshots" ADD COLUMN "listing_version_id" uuid;--> statement-breakpoint
ALTER TABLE "listing_versions" ADD CONSTRAINT "listing_versions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_versions_app_id_language_first_seen_at_index" ON "listing_versions" USING btree ("app_id","language","first_seen_at");--> statement-breakpoint
ALTER TABLE "rank_snapshots" ADD CONSTRAINT "rank_snapshots_listing_version_id_listing_versions_id_fk" FOREIGN KEY ("listing_version_id") REFERENCES "public"."listing_versions"("id") ON DELETE set null ON UPDATE no action;
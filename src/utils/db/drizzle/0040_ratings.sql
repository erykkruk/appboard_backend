CREATE TABLE "app_rating_refreshes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"completed_at" timestamp,
	"day" date NOT NULL,
	"done_countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"full_sweep" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"last_full_sweep_day" date,
	"next_attempt_at" timestamp,
	"reviews_synced" boolean DEFAULT false NOT NULL,
	CONSTRAINT "app_rating_refreshes_appId_unique" UNIQUE("app_id")
);
--> statement-breakpoint
CREATE TABLE "app_rating_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"average" real,
	"country" varchar(2) NOT NULL,
	"current_version_average" real,
	"current_version_rating_count" integer,
	"day" date NOT NULL,
	"fetched_at" timestamp NOT NULL,
	"histogram" jsonb,
	"rating_count" integer NOT NULL,
	"store_type" varchar(50) NOT NULL,
	"version" varchar(50),
	"written_reviews" integer,
	CONSTRAINT "app_rating_snapshots_appId_country_day_unique" UNIQUE("app_id","country","day")
);
--> statement-breakpoint
ALTER TABLE "app_rating_refreshes" ADD CONSTRAINT "app_rating_refreshes_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_rating_snapshots" ADD CONSTRAINT "app_rating_snapshots_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_rating_snapshots_app_id_day_index" ON "app_rating_snapshots" USING btree ("app_id","day");
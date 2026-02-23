CREATE TABLE "app_age_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"apple_questionnaire" jsonb,
	"apple_rating" varchar(50),
	"google_questionnaire" jsonb,
	"google_rating" varchar(50),
	"preset_id" varchar(50) NOT NULL,
	CONSTRAINT "app_age_ratings_appId_unique" UNIQUE("app_id")
);
--> statement-breakpoint
CREATE TABLE "app_privacy_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"data_collections" jsonb,
	"privacy_policy_url" varchar(2048),
	"template_id" varchar(50) NOT NULL,
	"tracking_domains" jsonb,
	"tracking_enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "app_privacy_declarations_appId_unique" UNIQUE("app_id")
);
--> statement-breakpoint
ALTER TABLE "app_age_ratings" ADD CONSTRAINT "app_age_ratings_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_privacy_declarations" ADD CONSTRAINT "app_privacy_declarations_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
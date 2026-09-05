CREATE TABLE "app_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"country" varchar(2) NOT NULL,
	"draft_score" integer,
	"report" jsonb NOT NULL,
	"started_at" timestamp,
	"status" varchar(20) DEFAULT 'ready' NOT NULL,
	"store_score" integer NOT NULL,
	CONSTRAINT "app_audits_appId_country_unique" UNIQUE("app_id","country")
);
--> statement-breakpoint
ALTER TABLE "app_audits" ADD CONSTRAINT "app_audits_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
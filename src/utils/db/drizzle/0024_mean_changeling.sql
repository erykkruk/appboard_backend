CREATE TABLE "public_aso_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_name" varchar(255),
	"aso_score" integer,
	"country" varchar(2) NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"keyword_count" integer NOT NULL,
	"source" varchar(32) DEFAULT 'web_client' NOT NULL,
	"track_id" varchar(32) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_keyword_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_rank" integer,
	"classification" varchar(32) NOT NULL,
	"country" varchar(2) NOT NULL,
	"day" date NOT NULL,
	"difficulty" integer NOT NULL,
	"keyword" varchar(255) NOT NULL,
	"opportunity" integer NOT NULL,
	"popularity" integer,
	"report_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public_keyword_observations" ADD CONSTRAINT "public_keyword_observations_report_id_public_aso_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."public_aso_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_aso_reports_track_id_country_index" ON "public_aso_reports" USING btree ("track_id","country");--> statement-breakpoint
CREATE INDEX "public_aso_reports_created_at_index" ON "public_aso_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "public_keyword_observations_keyword_country_day_index" ON "public_keyword_observations" USING btree ("keyword","country","day");--> statement-breakpoint
CREATE INDEX "public_keyword_observations_report_id_index" ON "public_keyword_observations" USING btree ("report_id");
CREATE TABLE "public_report_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_name" varchar(255),
	"country" varchar(8) NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"store" varchar(16) DEFAULT 'appstore' NOT NULL,
	"tool" varchar(32) DEFAULT 'aso-check' NOT NULL,
	"track_id" varchar(255)
);
--> statement-breakpoint
CREATE INDEX "public_report_shares_created_at_index" ON "public_report_shares" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "public_report_shares_track_id_index" ON "public_report_shares" USING btree ("track_id");
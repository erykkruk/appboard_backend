CREATE TABLE "keyword_score_snapshots" (
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
	"payload" jsonb NOT NULL,
	"popularity" integer,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "keyword_score_snapshots_workspaceId_keyword_country_day_unique" UNIQUE("workspace_id","keyword","country","day")
);
--> statement-breakpoint
ALTER TABLE "app_tracking_config" ADD COLUMN "last_score_refresh_at" timestamp;--> statement-breakpoint
ALTER TABLE "keyword_score_snapshots" ADD CONSTRAINT "keyword_score_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "keyword_score_snapshots_workspace_id_keyword_country_index" ON "keyword_score_snapshots" USING btree ("workspace_id","keyword","country");--> statement-breakpoint
CREATE INDEX "keyword_score_snapshots_workspace_id_day_index" ON "keyword_score_snapshots" USING btree ("workspace_id","day");
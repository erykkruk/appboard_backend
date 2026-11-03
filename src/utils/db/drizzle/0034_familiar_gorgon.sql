CREATE TABLE "rank_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"checked" integer DEFAULT 0 NOT NULL,
	"error" text,
	"failed" integer DEFAULT 0 NOT NULL,
	"failures" jsonb,
	"finished_at" timestamp,
	"kind" varchar(16) DEFAULT 'manual' NOT NULL,
	"measured" integer DEFAULT 0 NOT NULL,
	"ranked" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"workspace_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "devices" jsonb DEFAULT '["phone"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rank_check_runs" ADD CONSTRAINT "rank_check_runs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_check_runs" ADD CONSTRAINT "rank_check_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rank_check_runs_app_id_created_at_index" ON "rank_check_runs" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE INDEX "rank_check_runs_workspace_id_index" ON "rank_check_runs" USING btree ("workspace_id");
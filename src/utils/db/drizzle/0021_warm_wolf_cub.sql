CREATE TABLE "app_tracking_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"auto_research_enabled" boolean DEFAULT false NOT NULL,
	"auto_research_frequency" varchar(20) DEFAULT 'weekly' NOT NULL,
	"email_rank_digest" boolean DEFAULT false NOT NULL,
	"last_auto_research_at" timestamp,
	"last_rank_check_at" timestamp,
	"notify_email" varchar(255),
	"rank_tracking_enabled" boolean DEFAULT false NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "app_tracking_config_appId_unique" UNIQUE("app_id")
);
--> statement-breakpoint
CREATE TABLE "rank_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"country" varchar(2) NOT NULL,
	"keyword" varchar(255) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"position" integer
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid,
	"country" varchar(2),
	"external_id" varchar(255),
	"kind" varchar(20) DEFAULT 'manual' NOT NULL,
	"report" jsonb NOT NULL,
	"store" varchar(20),
	"summary" text,
	"title" varchar(255),
	"workspace_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"country" varchar(2) NOT NULL,
	"keyword" varchar(255) NOT NULL,
	CONSTRAINT "tracked_keywords_appId_country_keyword_unique" UNIQUE("app_id","country","keyword")
);
--> statement-breakpoint
ALTER TABLE "app_tracking_config" ADD CONSTRAINT "app_tracking_config_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_tracking_config" ADD CONSTRAINT "app_tracking_config_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_snapshots" ADD CONSTRAINT "rank_snapshots_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_keywords" ADD CONSTRAINT "tracked_keywords_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_tracking_config_workspace_id_index" ON "app_tracking_config" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "rank_snapshots_app_id_keyword_country_index" ON "rank_snapshots" USING btree ("app_id","keyword","country");--> statement-breakpoint
CREATE INDEX "rank_snapshots_app_id_index" ON "rank_snapshots" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "research_runs_workspace_id_index" ON "research_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "research_runs_app_id_index" ON "research_runs" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "tracked_keywords_app_id_index" ON "tracked_keywords" USING btree ("app_id");
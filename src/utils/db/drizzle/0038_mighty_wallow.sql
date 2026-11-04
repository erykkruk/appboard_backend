CREATE TABLE "workspace_daily_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"email" varchar(255),
	"enabled" boolean DEFAULT false NOT NULL,
	"last_sent_at" timestamp,
	"last_sent_on" varchar(10),
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "workspace_daily_summary_workspaceId_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_daily_summary" ADD CONSTRAINT "workspace_daily_summary_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
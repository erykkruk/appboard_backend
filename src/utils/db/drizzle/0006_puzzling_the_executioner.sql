CREATE TABLE "app_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "app_group_members_groupId_appId_unique" UNIQUE("group_id","app_id")
);
--> statement-breakpoint
CREATE TABLE "app_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"icon_url" varchar(1024),
	"name" varchar(255) NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "app_groups_workspaceId_name_unique" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
ALTER TABLE "app_group_members" ADD CONSTRAINT "app_group_members_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_group_members" ADD CONSTRAINT "app_group_members_group_id_app_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."app_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_groups" ADD CONSTRAINT "app_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
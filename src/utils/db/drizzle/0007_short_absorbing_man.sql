ALTER TABLE "app_group_members" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_groups" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
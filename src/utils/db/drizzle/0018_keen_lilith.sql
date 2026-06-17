CREATE TABLE "screenshot_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"asset_id" uuid,
	"display_type" varchar(50) NOT NULL,
	"language" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"scene" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "screenshot_scenes" ADD CONSTRAINT "screenshot_scenes_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshot_scenes" ADD CONSTRAINT "screenshot_scenes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screenshot_scenes_app_id_index" ON "screenshot_scenes" USING btree ("app_id");
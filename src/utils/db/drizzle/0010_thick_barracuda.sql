CREATE TABLE "purchase_review_info" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"review_notes" text,
	"screenshot_url" varchar(2048),
	"use_group_default" boolean DEFAULT true NOT NULL,
	CONSTRAINT "purchase_review_info_purchaseId_unique" UNIQUE("purchase_id")
);
--> statement-breakpoint
CREATE TABLE "subscription_group_localizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"description" text,
	"group_id" uuid NOT NULL,
	"language" varchar(20) NOT NULL,
	"name" varchar(255),
	CONSTRAINT "subscription_group_localizations_groupId_language_unique" UNIQUE("group_id","language")
);
--> statement-breakpoint
CREATE TABLE "subscription_group_review_info" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"group_id" uuid NOT NULL,
	"review_notes" text,
	"screenshot_url" varchar(2048),
	CONSTRAINT "subscription_group_review_info_groupId_unique" UNIQUE("group_id")
);
--> statement-breakpoint
ALTER TABLE "in_app_purchases" ADD COLUMN "available_territories" jsonb;--> statement-breakpoint
ALTER TABLE "in_app_purchases" ADD COLUMN "family_sharable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_groups" ADD COLUMN "available_territories" jsonb;--> statement-breakpoint
ALTER TABLE "purchase_review_info" ADD CONSTRAINT "purchase_review_info_purchase_id_in_app_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."in_app_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_group_localizations" ADD CONSTRAINT "subscription_group_localizations_group_id_subscription_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."subscription_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_group_review_info" ADD CONSTRAINT "subscription_group_review_info_group_id_subscription_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."subscription_groups"("id") ON DELETE cascade ON UPDATE no action;
CREATE TABLE "in_app_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"duration" varchar(50),
	"external_id" varchar(255) NOT NULL,
	"group_id" uuid,
	"name" varchar(255) NOT NULL,
	"product_id" varchar(255) NOT NULL,
	"product_type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'approved' NOT NULL,
	"synced_at" timestamp,
	CONSTRAINT "in_app_purchases_appId_externalId_unique" UNIQUE("app_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_localizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"description" text,
	"external_id" varchar(255),
	"language" varchar(20) NOT NULL,
	"name" varchar(255),
	"purchase_id" uuid NOT NULL,
	"synced_at" timestamp,
	CONSTRAINT "purchase_localizations_purchaseId_language_unique" UNIQUE("purchase_id","language")
);
--> statement-breakpoint
CREATE TABLE "purchase_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"currency" varchar(10) NOT NULL,
	"external_id" varchar(255),
	"price" varchar(50) NOT NULL,
	"purchase_id" uuid NOT NULL,
	"synced_at" timestamp,
	"territory" varchar(10) NOT NULL,
	CONSTRAINT "purchase_prices_purchaseId_territory_unique" UNIQUE("purchase_id","territory")
);
--> statement-breakpoint
CREATE TABLE "subscription_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"synced_at" timestamp,
	CONSTRAINT "subscription_groups_appId_externalId_unique" UNIQUE("app_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "in_app_purchases" ADD CONSTRAINT "in_app_purchases_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_purchases" ADD CONSTRAINT "in_app_purchases_group_id_subscription_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."subscription_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_localizations" ADD CONSTRAINT "purchase_localizations_purchase_id_in_app_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."in_app_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_prices" ADD CONSTRAINT "purchase_prices_purchase_id_in_app_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."in_app_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_groups" ADD CONSTRAINT "subscription_groups_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
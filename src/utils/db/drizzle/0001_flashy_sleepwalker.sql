CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"asset_type" varchar(50) NOT NULL,
	"device_type" varchar(50) NOT NULL,
	"external_id" varchar(255),
	"file_size" integer,
	"height" integer,
	"language" varchar(20) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp,
	"url" varchar(2048),
	"width" integer
);
--> statement-breakpoint
CREATE TABLE "listing_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"field" varchar(100) NOT NULL,
	"language" varchar(20) NOT NULL,
	"listing_id" uuid,
	"new_value" text,
	"old_value" text,
	"published_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"full_desc" text,
	"is_dirty" boolean DEFAULT false NOT NULL,
	"keywords" varchar(255),
	"language" varchar(20) NOT NULL,
	"marketing_url" varchar(1024),
	"privacy_url" varchar(1024),
	"promo_text" varchar(255),
	"short_desc" varchar(255),
	"source" varchar(20) DEFAULT 'remote' NOT NULL,
	"support_url" varchar(1024),
	"synced_at" timestamp,
	"title" varchar(255),
	"whats_new" text,
	CONSTRAINT "listings_appId_language_source_unique" UNIQUE("app_id","language","source")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"app_version" varchar(50),
	"author_name" varchar(255),
	"body" text,
	"device" varchar(255),
	"external_id" varchar(255) NOT NULL,
	"language" varchar(20),
	"os_version" varchar(50),
	"rating" integer NOT NULL,
	"replied_at" timestamp,
	"reply_text" text,
	"review_date" timestamp,
	"store_type" varchar(50) NOT NULL,
	"synced_at" timestamp,
	"territory" varchar(10),
	"title" varchar(500)
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_history" ADD CONSTRAINT "listing_history_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_history" ADD CONSTRAINT "listing_history_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
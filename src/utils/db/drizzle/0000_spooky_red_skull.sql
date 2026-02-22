CREATE TABLE IF NOT EXISTS "app_ai_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"field" varchar(50) NOT NULL,
	"mode" varchar(20) NOT NULL,
	"prompt" text NOT NULL,
	CONSTRAINT "app_ai_prompts_appId_field_mode_unique" UNIQUE("app_id","field","mode")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_aso_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"awards" jsonb,
	"brand_voice_example" text,
	"category" text,
	"competitive_advantage" text,
	"competitors" jsonb,
	"differentiator" text,
	"download_count" text,
	"exclude_keywords" jsonb,
	"free_features" jsonb,
	"key_features" jsonb,
	"long_tail_keywords" jsonb,
	"main_benefit" text,
	"must_include_keywords" jsonb,
	"one_liner" text,
	"pain_points" jsonb,
	"positioning" text,
	"premium_features" jsonb,
	"press_quotes" jsonb,
	"price" text,
	"pricing_model" text,
	"problem" text,
	"target_audience" text,
	"testimonials" jsonb,
	"tone" text,
	"user_language" text,
	"words_to_avoid" jsonb,
	"words_to_include" jsonb,
	CONSTRAINT "app_aso_profiles_appId_unique" UNIQUE("app_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"copyright" text,
	"copyright_dirty" boolean DEFAULT false NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"is_editable" boolean DEFAULT false NOT NULL,
	"state" varchar(100) NOT NULL,
	"synced_at" timestamp,
	"version_string" varchar(50) NOT NULL,
	CONSTRAINT "app_versions_appId_externalId_unique" UNIQUE("app_id","external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"bundle_id" varchar(255) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"icon_url" varchar(1024),
	"last_synced_at" timestamp,
	"name" varchar(255) NOT NULL,
	"platform" varchar(50) NOT NULL,
	"raw_data" jsonb,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"store_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"asset_type" varchar(50) NOT NULL,
	"device_type" varchar(50) NOT NULL,
	"external_id" varchar(255),
	"file_name" varchar(255),
	"file_size" integer,
	"height" integer,
	"is_dirty" boolean DEFAULT false NOT NULL,
	"language" varchar(20) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source" varchar(20) DEFAULT 'remote' NOT NULL,
	"synced_at" timestamp,
	"url" varchar(2048),
	"width" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listing_history" (
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
CREATE TABLE IF NOT EXISTS "listings" (
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
CREATE TABLE IF NOT EXISTS "reviews" (
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
CREATE TABLE IF NOT EXISTS "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"is_encrypted" boolean DEFAULT false NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text,
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"credentials" text,
	"last_synced_at" timestamp,
	"name" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'disconnected' NOT NULL,
	"type" varchar(50) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "version_localizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"description" text,
	"external_id" varchar(255),
	"is_dirty" boolean DEFAULT false NOT NULL,
	"keywords" varchar(255),
	"language" varchar(20) NOT NULL,
	"marketing_url" varchar(1024),
	"promotional_text" text,
	"source" varchar(20) DEFAULT 'remote' NOT NULL,
	"subtitle" varchar(255),
	"support_url" varchar(1024),
	"synced_at" timestamp,
	"title" varchar(255),
	"version_id" uuid NOT NULL,
	"whats_new" text,
	CONSTRAINT "version_localizations_versionId_language_source_unique" UNIQUE("version_id","language","source")
);
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "app_ai_prompts" ADD CONSTRAINT "app_ai_prompts_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "app_aso_profiles" ADD CONSTRAINT "app_aso_profiles_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "app_versions" ADD CONSTRAINT "app_versions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "apps" ADD CONSTRAINT "apps_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "assets" ADD CONSTRAINT "assets_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "listing_history" ADD CONSTRAINT "listing_history_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "listing_history" ADD CONSTRAINT "listing_history_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "listings" ADD CONSTRAINT "listings_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "version_localizations" ADD CONSTRAINT "version_localizations_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "version_localizations" ADD CONSTRAINT "version_localizations_version_id_app_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."app_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
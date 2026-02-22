import { sql } from "drizzle-orm";
import { createLogger } from "@/utils/logger";
import { db } from "./index";

const log = createLogger("migrate");

export async function runMigrations() {
	log.info("Syncing database schema...");
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "stores" (
			"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
			"created_at" timestamp DEFAULT now() NOT NULL,
			"updated_at" timestamp DEFAULT now() NOT NULL,
			"credentials" text,
			"last_synced_at" timestamp,
			"name" varchar(255) NOT NULL,
			"status" varchar(50) DEFAULT 'disconnected' NOT NULL,
			"type" varchar(50) NOT NULL
		)
	`);
	await db.execute(sql`
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
			"store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE
		)
	`);
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "settings" (
			"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
			"created_at" timestamp DEFAULT now() NOT NULL,
			"updated_at" timestamp DEFAULT now() NOT NULL,
			"is_encrypted" boolean DEFAULT false NOT NULL,
			"key" varchar(255) NOT NULL UNIQUE,
			"value" text
		)
	`);
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "listings" (
			"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
			"created_at" timestamp DEFAULT now() NOT NULL,
			"updated_at" timestamp DEFAULT now() NOT NULL,
			"app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
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
			UNIQUE("app_id", "language", "source")
		)
	`);
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "listing_history" (
			"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
			"created_at" timestamp DEFAULT now() NOT NULL,
			"updated_at" timestamp DEFAULT now() NOT NULL,
			"app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
			"field" varchar(100) NOT NULL,
			"language" varchar(20) NOT NULL,
			"listing_id" uuid REFERENCES "listings"("id") ON DELETE SET NULL,
			"new_value" text,
			"old_value" text,
			"published_at" timestamp
		)
	`);
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "assets" (
			"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
			"created_at" timestamp DEFAULT now() NOT NULL,
			"updated_at" timestamp DEFAULT now() NOT NULL,
			"app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
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
		)
	`);
	await db.execute(
		sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "file_name" varchar(255)`,
	);
	await db.execute(
		sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "is_dirty" boolean DEFAULT false NOT NULL`,
	);
	await db.execute(
		sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "source" varchar(20) DEFAULT 'remote' NOT NULL`,
	);
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "reviews" (
			"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
			"created_at" timestamp DEFAULT now() NOT NULL,
			"updated_at" timestamp DEFAULT now() NOT NULL,
			"app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
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
		)
	`);

	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "app_aso_profiles" (
			"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
			"created_at" timestamp DEFAULT now() NOT NULL,
			"updated_at" timestamp DEFAULT now() NOT NULL,
			"app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
			"awards" jsonb,
			"brand_voice_example" text,
			"category" varchar(100),
			"competitive_advantage" text,
			"competitors" jsonb,
			"differentiator" text,
			"download_count" varchar(50),
			"exclude_keywords" jsonb,
			"free_features" jsonb,
			"key_features" jsonb,
			"long_tail_keywords" jsonb,
			"main_benefit" text,
			"must_include_keywords" jsonb,
			"one_liner" varchar(300),
			"pain_points" jsonb,
			"positioning" varchar(50),
			"premium_features" jsonb,
			"press_quotes" jsonb,
			"price" varchar(100),
			"pricing_model" varchar(50),
			"problem" text,
			"target_audience" text,
			"testimonials" jsonb,
			"tone" varchar(50),
			"user_language" text,
			"words_to_avoid" jsonb,
			"words_to_include" jsonb,
			UNIQUE("app_id")
		)
	`);

	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "app_versions" (
			"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
			"created_at" timestamp DEFAULT now() NOT NULL,
			"updated_at" timestamp DEFAULT now() NOT NULL,
			"app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
			"copyright" text,
			"copyright_dirty" boolean DEFAULT false NOT NULL,
			"external_id" varchar(255) NOT NULL,
			"is_editable" boolean DEFAULT false NOT NULL,
			"state" varchar(100) NOT NULL,
			"synced_at" timestamp,
			"version_string" varchar(50) NOT NULL,
			UNIQUE("app_id", "external_id")
		)
	`);

	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "version_localizations" (
			"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
			"created_at" timestamp DEFAULT now() NOT NULL,
			"updated_at" timestamp DEFAULT now() NOT NULL,
			"app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
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
			"version_id" uuid NOT NULL REFERENCES "app_versions"("id") ON DELETE CASCADE,
			"whats_new" text,
			UNIQUE("version_id", "language", "source")
		)
	`);

	log.info("Database schema sync complete");
}

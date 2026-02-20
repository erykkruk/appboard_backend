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
			"file_size" integer,
			"height" integer,
			"language" varchar(20) NOT NULL,
			"sort_order" integer DEFAULT 0 NOT NULL,
			"synced_at" timestamp,
			"url" varchar(2048),
			"width" integer
		)
	`);
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

	log.info("Database schema sync complete");
}

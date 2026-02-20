CREATE TABLE "apps" (
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
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"is_encrypted" boolean DEFAULT false NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text,
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "stores" (
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
ALTER TABLE "apps" ADD CONSTRAINT "apps_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
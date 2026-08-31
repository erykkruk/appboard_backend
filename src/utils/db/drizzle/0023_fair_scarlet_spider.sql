CREATE TABLE "apple_dataset_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"country" varchar(2) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"term_count" integer NOT NULL,
	"week" date NOT NULL,
	CONSTRAINT "apple_dataset_weeks_country_week_unique" UNIQUE("country","week")
);
--> statement-breakpoint
CREATE TABLE "apple_impression_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"app_id" uuid NOT NULL,
	"country" varchar(2) NOT NULL,
	"high_share" real NOT NULL,
	"low_share" real NOT NULL,
	"popularity_tier" integer,
	"rank" integer,
	"search_term" varchar(200) NOT NULL,
	"week" date NOT NULL,
	CONSTRAINT "apple_impression_shares_appId_country_searchTerm_week_unique" UNIQUE("app_id","country","search_term","week")
);
--> statement-breakpoint
CREATE TABLE "apple_top_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"country" varchar(2) NOT NULL,
	"genre" varchar(100) NOT NULL,
	"popularity" integer NOT NULL,
	"popularity_in_genre" integer NOT NULL,
	"popularity_tier" integer NOT NULL,
	"rank_in_genre" integer NOT NULL,
	"term" varchar(200) NOT NULL,
	"week" date NOT NULL,
	CONSTRAINT "apple_top_terms_country_week_genre_term_unique" UNIQUE("country","week","genre","term")
);
--> statement-breakpoint
ALTER TABLE "apple_impression_shares" ADD CONSTRAINT "apple_impression_shares_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apple_dataset_weeks_country_index" ON "apple_dataset_weeks" USING btree ("country");--> statement-breakpoint
CREATE INDEX "apple_impression_shares_app_id_index" ON "apple_impression_shares" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "apple_top_terms_country_week_term_index" ON "apple_top_terms" USING btree ("country","week","term");--> statement-breakpoint
CREATE INDEX "apple_top_terms_country_week_genre_index" ON "apple_top_terms" USING btree ("country","week","genre");
CREATE TABLE "keyword_score_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"competitors" jsonb NOT NULL,
	"country" varchar(2) NOT NULL,
	"keyword" varchar(255) NOT NULL,
	"scored_at" timestamp NOT NULL,
	CONSTRAINT "keyword_score_cache_keyword_country_unique" UNIQUE("keyword","country")
);
--> statement-breakpoint
CREATE TABLE "keyword_score_refresh_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"day" date NOT NULL,
	"due" integer DEFAULT 0 NOT NULL,
	"error" text,
	"failed" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp,
	"pairs" integer DEFAULT 0 NOT NULL,
	"refreshed" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"target" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "keyword_score_refresh_runs_day_unique" UNIQUE("day")
);
--> statement-breakpoint
CREATE INDEX "keyword_score_cache_scored_at_index" ON "keyword_score_cache" USING btree ("scored_at");
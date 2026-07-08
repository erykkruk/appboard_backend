CREATE TABLE "error_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"code" varchar(64),
	"context" jsonb,
	"level" varchar(16) DEFAULT 'error' NOT NULL,
	"message" text,
	"method" varchar(12),
	"path" varchar(512),
	"status_code" integer,
	"user_id" text,
	"workspace_id" uuid
);
--> statement-breakpoint
CREATE INDEX "error_logs_created_at_index" ON "error_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "error_logs_workspace_id_index" ON "error_logs" USING btree ("workspace_id");
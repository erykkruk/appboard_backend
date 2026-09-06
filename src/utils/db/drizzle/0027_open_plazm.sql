CREATE TABLE "public_tool_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"day" date NOT NULL,
	"subject" varchar(64) NOT NULL,
	"subject_kind" varchar(8) NOT NULL,
	"tool" varchar(32) NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "public_tool_usage_day_tool_subjectKind_subject_unique" UNIQUE("day","tool","subject_kind","subject")
);
--> statement-breakpoint
CREATE INDEX "public_tool_usage_day_index" ON "public_tool_usage" USING btree ("day");
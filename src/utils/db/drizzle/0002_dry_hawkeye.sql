ALTER TABLE "assets" ADD COLUMN "file_name" varchar(255);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "is_dirty" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "source" varchar(20) DEFAULT 'remote' NOT NULL;
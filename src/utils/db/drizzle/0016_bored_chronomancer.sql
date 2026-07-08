ALTER TABLE "listings" ADD COLUMN "do_not_translate_fields" jsonb;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "translation_instructions" text;--> statement-breakpoint
ALTER TABLE "version_localizations" ADD COLUMN "do_not_translate_fields" jsonb;--> statement-breakpoint
ALTER TABLE "version_localizations" ADD COLUMN "translation_instructions" text;
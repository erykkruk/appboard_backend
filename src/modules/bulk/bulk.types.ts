import { t } from "elysia";

export const BULK_COPY_PARTS = [
	"about",
	"privacy",
	"ageRating",
	"keywords",
	"prompts",
	"listings",
] as const;
export type BulkCopyPart = (typeof BULK_COPY_PARTS)[number];

export const MAX_BULK_TARGETS = 50;

// Only the localized copy travels between apps; URLs, DNT keys and translation
// instructions are per-app configuration and stay where they are.
export const LISTING_COPY_FIELDS = [
	"title",
	"shortDesc",
	"fullDesc",
	"keywords",
	"promoText",
	"whatsNew",
] as const;
export type ListingCopyField = (typeof LISTING_COPY_FIELDS)[number];

export const bulkCopyBody = t.Object({
	parts: t.Array(t.Union(BULK_COPY_PARTS.map((part) => t.Literal(part))), {
		minItems: 1,
	}),
	sourceAppId: t.String({ format: "uuid" }),
	targetAppIds: t.Array(t.String({ format: "uuid" }), {
		maxItems: MAX_BULK_TARGETS,
		minItems: 1,
	}),
});

export interface BulkCopyRequest {
	parts: BulkCopyPart[];
	sourceAppId: string;
	targetAppIds: string[];
}

export interface BulkCopyChange {
	after: string | null;
	appId: string;
	appName: string;
	before: string | null;
	field: string;
	language?: string;
	part: BulkCopyPart;
}

export interface BulkCopySkip {
	appId: string;
	appName: string;
	part: BulkCopyPart;
	reason: string;
}

export interface BulkCopyPreview {
	changes: BulkCopyChange[];
	skipped: BulkCopySkip[];
}

export type BulkCopyStatus = "ok" | "error" | "skipped";

export interface BulkCopyResult {
	appId: string;
	appName: string;
	changed: number;
	message?: string;
	part: BulkCopyPart;
	status: BulkCopyStatus;
}

export interface BulkCopyApplyResponse {
	results: BulkCopyResult[];
}

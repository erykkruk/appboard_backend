import { createHash } from "node:crypto";
import type { ResearchReview } from "@/modules/research/research.types";
import type { AssetData, ReviewData } from "@/providers/store-provider";

/**
 * Public review feeds carry no store review ids, so reviews get a stable
 * synthetic id derived from their content — re-syncing upserts instead of
 * duplicating.
 */
function publicReviewId(review: ResearchReview): string {
	const digest = createHash("sha256")
		.update(`${review.title ?? ""}|${review.stars}|${review.text}`)
		.digest("hex");
	return `public-${digest.slice(0, 24)}`;
}

export function toReviewData(
	review: ResearchReview,
	fallbackAuthor: string,
): ReviewData {
	const parsed = review.date ? new Date(review.date) : null;
	return {
		authorName: fallbackAuthor,
		body: review.text,
		externalId: publicReviewId(review),
		rating: review.stars,
		reviewDate: parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(),
		title: review.title,
		...(review.version ? { appVersion: review.version } : {}),
	};
}

/** Screenshot URLs → asset rows with stable synthetic ids (hash of the URL). */
export function toScreenshotAssets(urls: string[]): AssetData[] {
	return urls.map((url) => ({
		assetType: "screenshot",
		deviceType: "phone",
		externalId: `public-${createHash("sha256").update(url).digest("hex").slice(0, 24)}`,
		url,
	}));
}

/** "Games, Action" → { primaryCategory: "Games", secondaryCategory: "Action" } */
export function splitGenres(genre: string | undefined): {
	primaryCategory: string | null;
	secondaryCategory: string | null;
} {
	const parts = (genre ?? "")
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);
	return {
		primaryCategory: parts[0] ?? null,
		secondaryCategory: parts[1] ?? null,
	};
}

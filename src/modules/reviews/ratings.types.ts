export const RATING_STORE_TYPES = ["app_store", "google_play"] as const;
export type RatingStoreType = (typeof RATING_STORE_TYPES)[number];

export const RATING_SCOPES = ["app", "group"] as const;
export type RatingScope = (typeof RATING_SCOPES)[number];

/** Star counts keyed "1".."5". */
export type RatingHistogram = Record<"1" | "2" | "3" | "4" | "5", number>;

/** One storefront's public rating, as the store page / lookup reports it. */
export interface CountryRating {
	average: number | null;
	country: string;
	currentVersionAverage: number | null;
	currentVersionRatingCount: number | null;
	histogram: RatingHistogram | null;
	/** Every rating, star-only ones included. */
	ratingCount: number;
	version: string | null;
	/** Ratings with text, when the store reports the count (Google Play). */
	writtenReviews: number | null;
}

/** A stored snapshot row, the input of the summary aggregation. */
export interface RatingSnapshotRow {
	appId: string;
	average: number | null;
	country: string;
	day: string;
	externalId: string;
	fetchedAt: Date;
	histogram: RatingHistogram | null;
	ratingCount: number;
	storeType: RatingStoreType;
	writtenReviews: number | null;
}

export interface CountryRatingSummary {
	average: number | null;
	country: string;
	fetchedAt: string;
	histogram: RatingHistogram | null;
	ratingCount: number;
	writtenReviews: number;
}

export interface StoreRatingSummary {
	average: number | null;
	countries: CountryRatingSummary[];
	fetchedAt: string | null;
	/** Summed over the countries that report one; null when none does. */
	histogram: RatingHistogram | null;
	ratingCount: number;
	storeType: RatingStoreType;
	/** Reviews with text in AppBoard's own table for these apps. */
	syncedReviews: number;
	writtenReviews: number;
}

export interface RatingTotals {
	average: number | null;
	ratingCount: number;
	writtenReviews: number;
}

export interface RatingsSummaryApp {
	appId: string;
	devices: string[];
	externalId: string;
	lastRefreshedAt: string | null;
	name: string;
	platform: string;
	storeType: string;
}

export interface RatingsSummary {
	apps: RatingsSummaryApp[];
	fetchedAt: string | null;
	group: { id: string; name: string } | null;
	refreshing: boolean;
	scope: RatingScope;
	stores: StoreRatingSummary[];
	total: RatingTotals;
}

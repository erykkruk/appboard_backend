import type { CountryRating, RatingHistogram } from "./ratings.types";

const STAR_KEYS = ["1", "2", "3", "4", "5"] as const;
const MAX_STARS = 5;
const MIN_STARS = 1;

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function count(value: unknown): number | null {
	const n = finiteNumber(value);
	return n !== null && n >= 0 ? Math.round(n) : null;
}

function average(value: unknown): number | null {
	const n = finiteNumber(value);
	return n !== null && n >= MIN_STARS && n <= MAX_STARS ? n : null;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value ? value : null;
}

function histogramFrom(value: unknown): RatingHistogram | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	const histogram = {} as RatingHistogram;
	for (const key of STAR_KEYS) {
		histogram[key] = count(raw[key]) ?? 0;
	}
	return histogram;
}

/**
 * The rating of one storefront from an iTunes Lookup answer
 * (`/lookup?id=..&country=..`). Null when the app is not sold there (the
 * lookup answers `resultCount: 0`). Apple reports no histogram and no count
 * of written reviews here.
 */
export function parseItunesLookupRating(
	json: unknown,
	country: string,
): CountryRating | null {
	const results = (json as { results?: unknown } | null)?.results;
	if (!Array.isArray(results) || results.length === 0) return null;
	const app = results[0] as Record<string, unknown>;
	const ratingCount = count(app.userRatingCount) ?? 0;
	return {
		average: ratingCount > 0 ? average(app.averageUserRating) : null,
		country,
		currentVersionAverage: average(app.averageUserRatingForCurrentVersion),
		currentVersionRatingCount: count(app.userRatingCountForCurrentVersion),
		histogram: null,
		ratingCount,
		version: text(app.version),
		writtenReviews: null,
	};
}

/**
 * The rating of one Google Play country from the public store page
 * (google-play-scraper `app()`). Google shows a rating per country, so a
 * country with no ratings yet has no score and an all-zero histogram.
 */
export function parsePlayAppRating(
	app: unknown,
	country: string,
): CountryRating | null {
	if (!app || typeof app !== "object") return null;
	const raw = app as Record<string, unknown>;
	const histogram = histogramFrom(raw.histogram);
	const histogramTotal = histogram
		? STAR_KEYS.reduce((sum, key) => sum + histogram[key], 0)
		: 0;
	const ratingCount = count(raw.ratings) ?? histogramTotal;
	return {
		average: ratingCount > 0 ? average(raw.score) : null,
		country,
		currentVersionAverage: null,
		currentVersionRatingCount: null,
		histogram: histogramTotal > 0 ? histogram : null,
		ratingCount,
		version: text(raw.version),
		writtenReviews: count(raw.reviews),
	};
}

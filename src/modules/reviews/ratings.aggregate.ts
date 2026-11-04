import {
	type CountryRatingSummary,
	RATING_STORE_TYPES,
	type RatingHistogram,
	type RatingSnapshotRow,
	type RatingStoreType,
	type RatingTotals,
	type StoreRatingSummary,
} from "./ratings.types";

/**
 * A country's snapshot older than its app's newest refresh by more than this
 * is left out: the store stopped reporting it (the app left that storefront),
 * so it must not keep inflating the total.
 */
export const RATING_SNAPSHOT_MAX_LAG_DAYS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const AVERAGE_DECIMALS = 1_000;
const STAR_KEYS = ["1", "2", "3", "4", "5"] as const;

function dayIndex(day: string): number {
	return Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

/**
 * Average over every rating, each part (a country, a listing) weighted by
 * its rating count. Always pass the raw snapshot rows, never already rounded
 * averages, so the rounding happens once.
 */
export function weightedAverage(
	parts: { average: number | null; ratingCount: number }[],
): number | null {
	let weight = 0;
	let sum = 0;
	for (const part of parts) {
		if (part.average === null || part.ratingCount <= 0) continue;
		weight += part.ratingCount;
		sum += part.average * part.ratingCount;
	}
	if (weight === 0) return null;
	return Math.round((sum / weight) * AVERAGE_DECIMALS) / AVERAGE_DECIMALS;
}

function sumHistograms(
	histograms: (RatingHistogram | null)[],
): RatingHistogram | null {
	const present = histograms.filter((h): h is RatingHistogram => h !== null);
	if (!present.length) return null;
	const total = {} as RatingHistogram;
	for (const key of STAR_KEYS) {
		total[key] = present.reduce((sum, h) => sum + h[key], 0);
	}
	return total;
}

/**
 * The newest snapshot per app and country, without countries the app's
 * latest refresh no longer saw. Input order does not matter.
 */
export function latestSnapshots(
	rows: RatingSnapshotRow[],
): RatingSnapshotRow[] {
	const newestDayByApp = new Map<string, number>();
	const latest = new Map<string, RatingSnapshotRow>();
	for (const row of rows) {
		const day = dayIndex(row.day);
		newestDayByApp.set(
			row.appId,
			Math.max(newestDayByApp.get(row.appId) ?? day, day),
		);
		const key = `${row.appId}:${row.country}`;
		const current = latest.get(key);
		if (!current || dayIndex(current.day) < day) latest.set(key, row);
	}
	return [...latest.values()].filter(
		(row) =>
			(newestDayByApp.get(row.appId) ?? 0) - dayIndex(row.day) <=
			RATING_SNAPSHOT_MAX_LAG_DAYS,
	);
}

/**
 * One row per store listing and country. Two AppBoard records can point at
 * the same listing (an iPhone record and an Apple TV record of one App Store
 * app share its ratings); counting both would double the total.
 */
export function dedupeListings(rows: RatingSnapshotRow[]): RatingSnapshotRow[] {
	const byListing = new Map<string, RatingSnapshotRow>();
	for (const row of rows) {
		const key = `${row.storeType}:${row.externalId}:${row.country}`;
		const current = byListing.get(key);
		if (!current || current.fetchedAt < row.fetchedAt) {
			byListing.set(key, row);
		}
	}
	return [...byListing.values()];
}

function summarizeCountry(rows: RatingSnapshotRow[]): CountryRatingSummary {
	const fetchedAt = rows.reduce(
		(max, r) => (r.fetchedAt > max ? r.fetchedAt : max),
		rows[0].fetchedAt,
	);
	return {
		average: weightedAverage(rows),
		country: rows[0].country,
		fetchedAt: fetchedAt.toISOString(),
		histogram: sumHistograms(rows.map((r) => r.histogram)),
		ratingCount: rows.reduce((sum, r) => sum + r.ratingCount, 0),
		writtenReviews: rows.reduce((sum, r) => sum + (r.writtenReviews ?? 0), 0),
	};
}

/**
 * Per-store and per-country totals from rating snapshots. Several listings
 * of one store (an Android phone app and an Android TV app in one group) add
 * up per country. `syncedReviews` is the count of review rows AppBoard holds
 * per store, shown next to the store's own counts.
 */
export function aggregateRatings(
	rows: RatingSnapshotRow[],
	syncedReviews: Partial<Record<RatingStoreType, number>> = {},
): { stores: StoreRatingSummary[]; total: RatingTotals } {
	const usable = dedupeListings(latestSnapshots(rows));
	const stores: StoreRatingSummary[] = [];
	for (const storeType of RATING_STORE_TYPES) {
		const storeRows = usable.filter((r) => r.storeType === storeType);
		if (!storeRows.length && !syncedReviews[storeType]) continue;
		const byCountry = new Map<string, RatingSnapshotRow[]>();
		for (const row of storeRows) {
			byCountry.set(row.country, [...(byCountry.get(row.country) ?? []), row]);
		}
		const countries = [...byCountry.values()]
			.map(summarizeCountry)
			.sort(
				(a, b) =>
					b.ratingCount - a.ratingCount || a.country.localeCompare(b.country),
			);
		const fetchedAt = countries.reduce<string | null>(
			(max, c) => (max === null || c.fetchedAt > max ? c.fetchedAt : max),
			null,
		);
		stores.push({
			average: weightedAverage(storeRows),
			countries,
			fetchedAt,
			histogram: sumHistograms(countries.map((c) => c.histogram)),
			ratingCount: countries.reduce((sum, c) => sum + c.ratingCount, 0),
			storeType,
			syncedReviews: syncedReviews[storeType] ?? 0,
			writtenReviews: countries.reduce((sum, c) => sum + c.writtenReviews, 0),
		});
	}
	return {
		stores,
		total: {
			average: weightedAverage(usable),
			ratingCount: stores.reduce((sum, s) => sum + s.ratingCount, 0),
			writtenReviews: stores.reduce((sum, s) => sum + s.writtenReviews, 0),
		},
	};
}

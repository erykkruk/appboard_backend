import { describe, expect, it } from "bun:test";
import {
	aggregateRatings,
	dedupeListings,
	latestSnapshots,
	weightedAverage,
} from "@/modules/reviews/ratings.aggregate";
import { daysBetween, localClock } from "@/modules/reviews/ratings.clock";
import {
	parseItunesLookupRating,
	parsePlayAppRating,
} from "@/modules/reviews/ratings.parsers";
import type { RatingSnapshotRow } from "@/modules/reviews/ratings.types";
import {
	alpha3ForCountry,
	countryFromTerritory,
	STORE_COUNTRY_CODES,
} from "@/modules/reviews/store-countries";
import itunesMissing from "./fixtures/itunes-lookup-ratings-missing.json";
import itunesPl from "./fixtures/itunes-lookup-ratings-pl.json";
import itunesUs from "./fixtures/itunes-lookup-ratings-us.json";
import playPl from "./fixtures/play-app-ratings-pl.json";
import playUs from "./fixtures/play-app-ratings-us.json";

// Fixtures are real public answers for Buzzin (App Store id 6787068440,
// Play tech.ravenlab.buzzin) captured on 2026-11-04, trimmed to the fields
// the parsers read.

describe("iTunes Lookup rating parser", () => {
	it("reads average, count and the current-version fields", () => {
		const rating = parseItunesLookupRating(itunesPl, "pl");
		expect(rating).toEqual({
			average: 4.59259,
			country: "pl",
			currentVersionAverage: 4.59259,
			currentVersionRatingCount: 27,
			histogram: null,
			ratingCount: 27,
			version: "1.7.5",
			writtenReviews: null,
		});
		expect(parseItunesLookupRating(itunesUs, "us")?.ratingCount).toBe(5);
	});

	it("returns null when the app is not sold in the storefront", () => {
		expect(parseItunesLookupRating(itunesMissing, "cn")).toBeNull();
		expect(parseItunesLookupRating(null, "cn")).toBeNull();
		expect(parseItunesLookupRating({}, "cn")).toBeNull();
	});

	it("has no average without ratings and ignores out-of-range values", () => {
		const none = parseItunesLookupRating(
			{ results: [{ averageUserRating: 0, userRatingCount: 0 }] },
			"de",
		);
		expect(none?.ratingCount).toBe(0);
		expect(none?.average).toBeNull();

		const broken = parseItunesLookupRating(
			{ results: [{ averageUserRating: 9, userRatingCount: "12" }] },
			"de",
		);
		expect(broken?.ratingCount).toBe(0);
		expect(broken?.average).toBeNull();
	});
});

describe("Google Play page rating parser", () => {
	it("reads score, ratings, written reviews and the histogram", () => {
		const rating = parsePlayAppRating(playPl, "pl");
		expect(rating).toEqual({
			average: 4.529412,
			country: "pl",
			currentVersionAverage: null,
			currentVersionRatingCount: null,
			histogram: { "1": 5, "2": 3, "3": 0, "4": 3, "5": 61 },
			ratingCount: 73,
			version: "1.7.5",
			writtenReviews: 21,
		});
	});

	it("a country without ratings has zero count and no histogram", () => {
		const rating = parsePlayAppRating(playUs, "us");
		expect(rating?.ratingCount).toBe(0);
		expect(rating?.average).toBeNull();
		expect(rating?.histogram).toBeNull();
		expect(rating?.writtenReviews).toBeNull();
	});

	it("falls back to the histogram total when the count is missing", () => {
		const rating = parsePlayAppRating(
			{ histogram: { 1: 1, 2: 0, 3: 0, 4: 1, 5: 2 }, score: 3.75 },
			"de",
		);
		expect(rating?.ratingCount).toBe(4);
		expect(rating?.average).toBe(3.75);
	});

	it("rejects a non-object page", () => {
		expect(parsePlayAppRating(null, "pl")).toBeNull();
		expect(parsePlayAppRating("x", "pl")).toBeNull();
	});
});

describe("store countries", () => {
	it("maps App Store Connect alpha-3 territories to alpha-2", () => {
		expect(countryFromTerritory("USA")).toBe("us");
		expect(countryFromTerritory("POL")).toBe("pl");
		expect(countryFromTerritory("GBR")).toBe("gb");
		expect(countryFromTerritory("pl")).toBe("pl");
		expect(countryFromTerritory("US")).toBe("us");
		expect(countryFromTerritory("ZZZ")).toBeNull();
		expect(countryFromTerritory(null)).toBeNull();
		expect(countryFromTerritory("")).toBeNull();
		expect(alpha3ForCountry("de")).toBe("DEU");
		expect(alpha3ForCountry("PL")).toBe("POL");
	});

	it("lists every storefront once, sorted", () => {
		expect(new Set(STORE_COUNTRY_CODES).size).toBe(STORE_COUNTRY_CODES.length);
		expect([...STORE_COUNTRY_CODES].sort()).toEqual([...STORE_COUNTRY_CODES]);
		expect(STORE_COUNTRY_CODES.length).toBeGreaterThan(170);
		for (const cc of ["pl", "us", "de", "es", "gb", "br", "tr"]) {
			expect(STORE_COUNTRY_CODES).toContain(cc);
		}
	});
});

describe("ratings clock", () => {
	it("gives the local day and hour in the scheduler timezone", () => {
		// 2026-11-04 03:30 UTC = 04:30 in Warsaw (CET).
		const clock = localClock(new Date("2026-11-04T03:30:00Z"), "Europe/Warsaw");
		expect(clock).toEqual({ day: "2026-11-04", hour: 4, minute: 30 });
		// 23:30 UTC on the 3rd is already the 4th in Warsaw.
		expect(
			localClock(new Date("2026-11-03T23:30:00Z"), "Europe/Warsaw").day,
		).toBe("2026-11-04");
		expect(daysBetween("2026-10-28", "2026-11-04")).toBe(7);
	});
});

function row(partial: Partial<RatingSnapshotRow>): RatingSnapshotRow {
	return {
		appId: "ios",
		average: 5,
		country: "pl",
		day: "2026-11-04",
		externalId: "6787068440",
		fetchedAt: new Date("2026-11-04T03:00:00Z"),
		histogram: null,
		ratingCount: 1,
		storeType: "app_store",
		writtenReviews: 0,
		...partial,
	};
}

describe("ratings aggregation", () => {
	it("weights the average by rating count", () => {
		// 27 x 4.59259 + 5 x 5 + 3 x 3.66667 = 160 over 35 ratings.
		expect(
			weightedAverage([
				{ average: 4.59259, ratingCount: 27 },
				{ average: 5, ratingCount: 5 },
				{ average: 3.66667, ratingCount: 3 },
			]),
		).toBe(4.571);
		expect(weightedAverage([{ average: null, ratingCount: 0 }])).toBeNull();
		expect(weightedAverage([])).toBeNull();
	});

	it("keeps the newest snapshot per app and country, dropping stale ones", () => {
		const rows = [
			row({ day: "2026-11-03", ratingCount: 26 }),
			row({ day: "2026-11-04", ratingCount: 27 }),
			row({ country: "us", day: "2026-11-04", ratingCount: 5 }),
			// Not seen for 10 days: the app left that storefront.
			row({ country: "br", day: "2026-10-25", ratingCount: 2 }),
		];
		const latest = latestSnapshots(rows);
		expect(latest.map((r) => [r.country, r.ratingCount]).sort()).toEqual([
			["pl", 27],
			["us", 5],
		]);
	});

	it("counts a listing shared by two records once", () => {
		const iphone = row({ appId: "iphone", ratingCount: 27 });
		const appleTv = row({
			appId: "apple-tv",
			fetchedAt: new Date("2026-11-04T03:05:00Z"),
			ratingCount: 27,
		});
		expect(dedupeListings([iphone, appleTv])).toHaveLength(1);
		const summary = aggregateRatings([iphone, appleTv]);
		expect(summary.total.ratingCount).toBe(27);
	});

	it("sums stores and countries and computes the weighted total", () => {
		const summary = aggregateRatings(
			[
				row({
					average: 4.59259,
					country: "pl",
					ratingCount: 27,
					writtenReviews: 4,
				}),
				row({ average: 5, country: "us", ratingCount: 5, writtenReviews: 2 }),
				row({
					appId: "android",
					average: 4.529412,
					country: "pl",
					externalId: "tech.ravenlab.buzzin",
					histogram: { "1": 5, "2": 3, "3": 0, "4": 3, "5": 61 },
					ratingCount: 73,
					storeType: "google_play",
					writtenReviews: 21,
				}),
				// A second Android listing (Android TV) adds up in the same country.
				row({
					appId: "android-tv",
					average: 4,
					country: "pl",
					externalId: "com.playbuzzin.tv",
					histogram: { "1": 0, "2": 0, "3": 0, "4": 2, "5": 0 },
					ratingCount: 2,
					storeType: "google_play",
					writtenReviews: 1,
				}),
			],
			{ app_store: 6, google_play: 3 },
		);

		const appStore = summary.stores.find((s) => s.storeType === "app_store");
		expect(appStore?.ratingCount).toBe(32);
		expect(appStore?.writtenReviews).toBe(6);
		expect(appStore?.syncedReviews).toBe(6);
		expect(appStore?.average).toBe(4.656);
		expect(appStore?.histogram).toBeNull();
		expect(appStore?.countries.map((c) => c.country)).toEqual(["pl", "us"]);

		const play = summary.stores.find((s) => s.storeType === "google_play");
		expect(play?.ratingCount).toBe(75);
		expect(play?.writtenReviews).toBe(22);
		expect(play?.syncedReviews).toBe(3);
		expect(play?.histogram).toEqual({
			"1": 5,
			"2": 3,
			"3": 0,
			"4": 5,
			"5": 61,
		});
		expect(play?.countries).toHaveLength(1);
		expect(play?.countries[0].average).toBe(4.515);

		expect(summary.total.ratingCount).toBe(107);
		expect(summary.total.writtenReviews).toBe(28);
		// (124 + 25 + 330.647 + 8) / 107, from the raw rows, rounded once.
		expect(summary.total.average).toBe(4.557);
	});

	it("lists a store with synced reviews but no ratings yet", () => {
		const summary = aggregateRatings([], { app_store: 2 });
		expect(summary.stores).toHaveLength(1);
		expect(summary.stores[0].ratingCount).toBe(0);
		expect(summary.stores[0].average).toBeNull();
		expect(summary.total.average).toBeNull();
	});
});

/**
 * Parity tests against the original RespectASO implementation.
 *
 * `fixtures/keyword-scoring-golden.json` holds outputs produced by running
 * the ORIGINAL Python code (aso/services.py + aso/scoring.py from
 * github.com/respectlytics/respectaso) on the exact fixtures rebuilt below -
 * see `fixtures/keyword-scoring-golden.gen.py` for the generator. Time-based
 * signals were frozen at 2026-08-30 UTC in both implementations.
 *
 * If these tests fail after an algorithm edit, the port has drifted from the
 * reference implementation - regenerate the golden file deliberately or fix
 * the drift.
 */
import { describe, expect, it } from "bun:test";
import {
	calcOpportunity,
	calculateDifficulty,
	classifyKeyword,
	estimateDownloads,
	estimatePopularity,
} from "@/modules/research/keyword-scoring";
import type { KeywordCompetitor } from "@/modules/research/research.types";
import golden from "./fixtures/keyword-scoring-golden.json";

const FROZEN_NOW = new Date("2026-08-30T00:00:00Z");

function comp(
	title: string,
	developer: string,
	ratingsCount: number,
	rating = 4.5,
	released = "2019-01-01T00:00:00Z",
	genre = "Productivity",
): KeywordCompetitor {
	return {
		developer,
		genre,
		rating,
		ratingsCount,
		released,
		title,
		trackId: title,
	};
}

/** Same fixtures as the Python golden generator - keep in sync. */
const FIXTURES: Record<
	string,
	{ keyword: string; competitors: KeywordCompetitor[] }
> = {
	backfill_lan_invoice: {
		competitors: [
			comp("Lan Invoice Tool", "Tiny Dev", 40),
			...Array.from({ length: 9 }, (_, i) =>
				comp(`Giant Unrelated ${i}`, `BigCo ${i}`, 500_000),
			),
		],
		keyword: "lan invoice",
	},
	brand_spotify: {
		competitors: [
			comp("Spotify: Music and Podcasts", "Spotify AB", 25_000_000, 4.8),
			...Array.from({ length: 9 }, (_, i) =>
				comp(`Music App ${i}`, `Label ${i}`, 100_000),
			),
		],
		keyword: "spotify",
	},
	finance_call_options: {
		competitors: [
			comp(
				"Call Recorder",
				"RecApps",
				50_000,
				4.2,
				"2018-01-01T00:00:00Z",
				"Utilities",
			),
			comp(
				"Video Call Options",
				"ChatCo",
				30_000,
				4.3,
				"2019-01-01T00:00:00Z",
				"Social Networking",
			),
			comp(
				"Options Trading Pro",
				"TradeCo",
				8_000,
				4.6,
				"2020-01-01T00:00:00Z",
				"Finance",
			),
			comp(
				"WiFi Calling",
				"TelApps",
				90_000,
				4.1,
				"2017-01-01T00:00:00Z",
				"Utilities",
			),
			comp(
				"Stock Options Tracker",
				"FinTrack",
				2_000,
				4.5,
				"2021-01-01T00:00:00Z",
				"Finance",
			),
		],
		keyword: "call options",
	},
	mixed_habit: {
		competitors: [
			comp(
				"Habit Tracker - Daily Planner",
				"HabitCo",
				80_000,
				4.7,
				"2017-05-01T00:00:00Z",
			),
			comp(
				"Habitify: Habit Tracker",
				"Unstatic",
				40_000,
				4.6,
				"2018-02-01T00:00:00Z",
			),
			comp("Streaks", "Crunchy Bagel", 25_000, 4.8, "2015-06-01T00:00:00Z"),
			comp(
				"Productive - Habit Tracker",
				"Apalon",
				60_000,
				4.7,
				"2016-03-01T00:00:00Z",
			),
			comp("Loop Habit Tracker", "OpenLoop", 900, 4.4, "2026-01-15T00:00:00Z"),
			comp(
				"Done: A Simple Habit Tracker",
				"DoneApps",
				12_000,
				4.5,
				"2019-09-01T00:00:00Z",
			),
			comp("Way of Life", "WayOfLife", 8_000, 4.6, "2014-01-01T00:00:00Z"),
			comp(
				"Strides: Goal & Habit Tracker",
				"Strides",
				15_000,
				4.7,
				"2015-11-01T00:00:00Z",
			),
			comp(
				"Today Planner",
				"TodayInc",
				300,
				4.2,
				"2026-03-01T00:00:00Z",
				"Lifestyle",
			),
			comp(
				"Calendar Notes",
				"NotesCo",
				5_000,
				4.3,
				"2020-07-01T00:00:00Z",
				"Utilities",
			),
		],
		keyword: "habit tracker",
	},
	small_set: {
		competitors: [
			comp("Giant One", "Mega Corp", 2_000_000),
			comp("Giant Two", "Mega Corp 2", 1_000_000),
		],
		keyword: "obscure niche tool",
	},
	strong_fitness: {
		competitors: Array.from({ length: 10 }, (_, i) =>
			comp(`fitness - App ${i}`, `Publisher ${i}`, 200_000 - i * 10_000),
		),
		keyword: "fitness",
	},
};

/** "Very Hard" -> "very-hard", "Sweet Spot" -> "sweet-spot", etc. */
function kebab(label: string): string {
	return label.toLowerCase().replace(/ /g, "-");
}

const OVERRIDE_MAP: Record<string, string> = {
	backfill: "backfill",
	small_result_set: "smallResultSet",
	weak_leader: "weakLeader",
};

interface GoldenTier {
	tier_score: number;
	label: string;
	min_reviews: number;
	median_reviews: number;
	weak_count: number;
	fresh_count: number;
	title_keyword_count: number;
	total_apps: number;
}

interface GoldenFixture {
	keyword: string;
	popularity: number | null;
	difficulty: number;
	rawTotal: number;
	overrideReason: string | null;
	isBrand: boolean;
	titleMatchCount: number;
	medianReviews: number;
	opportunity: number;
	classification: string | null;
	tiers: { top_5: GoldenTier; top_10: GoldenTier; top_20: GoldenTier };
}

describe("parity with original RespectASO implementation", () => {
	const fixtures = golden.fixtures as Record<string, GoldenFixture>;

	for (const [name, expected] of Object.entries(fixtures)) {
		it(`matches golden values for "${name}"`, () => {
			const { competitors, keyword } = FIXTURES[name];
			expect(competitors).toBeDefined();

			const popularity = estimatePopularity(competitors, keyword);
			expect(popularity).toBe(expected.popularity);

			const difficulty = calculateDifficulty(competitors, keyword, FROZEN_NOW);
			expect(difficulty.score).toBe(expected.difficulty);
			expect(difficulty.breakdown.rawTotal).toBe(expected.rawTotal);
			expect(difficulty.breakdown.overrideReason).toBe(
				(expected.overrideReason
					? OVERRIDE_MAP[expected.overrideReason]
					: null) as never,
			);
			expect(difficulty.breakdown.isBrandKeyword).toBe(expected.isBrand);
			expect(difficulty.breakdown.titleMatchCount).toBe(
				expected.titleMatchCount,
			);
			expect(difficulty.breakdown.medianReviews).toBe(expected.medianReviews);

			expect(calcOpportunity(popularity ?? 0, difficulty.score)).toBe(
				expected.opportunity,
			);
			if (expected.classification) {
				expect(String(classifyKeyword(popularity, difficulty.score))).toBe(
					kebab(expected.classification),
				);
			}

			const tierPairs = [
				["top5", expected.tiers.top_5],
				["top10", expected.tiers.top_10],
				["top20", expected.tiers.top_20],
			] as const;
			for (const [key, goldenTier] of tierPairs) {
				const tier = difficulty.tiers[key];
				expect(tier.tierScore).toBe(goldenTier.tier_score);
				expect(tier.label).toBe(kebab(goldenTier.label));
				expect(tier.minReviews).toBe(goldenTier.min_reviews);
				expect(tier.medianReviews).toBe(goldenTier.median_reviews);
				expect(tier.weakCount).toBe(goldenTier.weak_count);
				expect(tier.freshCount).toBe(goldenTier.fresh_count);
				expect(tier.titleKeywordCount).toBe(goldenTier.title_keyword_count);
				expect(tier.totalApps).toBe(goldenTier.total_apps);
			}
		});
	}

	it("matches the golden opportunity table", () => {
		for (const [key, value] of Object.entries(
			golden.opportunity_table as Record<string, number>,
		)) {
			const [pop, diff] = key.split("_").map(Number);
			expect(calcOpportunity(pop, diff)).toBe(value);
		}
	});

	it("matches the golden classification table", () => {
		for (const [key, value] of Object.entries(
			golden.classification_table as Record<string, string>,
		)) {
			const [pop, diff] = key.split("_").map(Number);
			expect(classifyKeyword(pop, diff)).toBe(kebab(value) as never);
		}
	});

	it("matches golden download estimates", () => {
		const cases = [
			["pop70_us", 70, "us"],
			["pop40_pl", 40, "pl"],
			["pop40_pk", 40, "pk"],
		] as const;
		interface GoldenDownloads {
			daily_searches: number;
			positions: Array<{
				pos: number;
				ttr: number;
				downloads_low: number;
				downloads_high: number;
			}>;
			tiers: {
				top_5: { low: number; high: number };
				top_6_10: { low: number; high: number };
				top_11_20: { low: number; high: number };
			};
		}
		for (const [key, pop, country] of cases) {
			const expected = (golden.downloads as Record<string, GoldenDownloads>)[
				key
			];
			const actual = estimateDownloads(pop, country);
			expect(actual.dailySearches).toBeCloseTo(expected.daily_searches, 1);
			expect(actual.positions).toHaveLength(expected.positions.length);
			expected.positions.forEach((goldenPos, i) => {
				const actualPos = actual.positions[i];
				expect(actualPos.position).toBe(goldenPos.pos);
				expect(actualPos.ttr).toBeCloseTo(goldenPos.ttr, 1);
				expect(actualPos.low).toBeCloseTo(goldenPos.downloads_low, 1);
				expect(actualPos.high).toBeCloseTo(goldenPos.downloads_high, 1);
			});
			expect(actual.tiers.top5.low).toBeCloseTo(expected.tiers.top_5.low, 1);
			expect(actual.tiers.top5.high).toBeCloseTo(expected.tiers.top_5.high, 1);
			expect(actual.tiers.top6to10.low).toBeCloseTo(
				expected.tiers.top_6_10.low,
				1,
			);
			expect(actual.tiers.top6to10.high).toBeCloseTo(
				expected.tiers.top_6_10.high,
				1,
			);
			expect(actual.tiers.top11to20.low).toBeCloseTo(
				expected.tiers.top_11_20.low,
				1,
			);
			expect(actual.tiers.top11to20.high).toBeCloseTo(
				expected.tiers.top_11_20.high,
				1,
			);
		}
	});
});

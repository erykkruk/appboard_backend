import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
	asciiText,
	buildDailySummaryEmail,
	pickMovers,
	starredSummary,
	strongestMarkets,
	summarizeTotals,
} from "@/modules/daily-summary/daily-summary.builder";
import type { SummaryMover } from "@/modules/daily-summary/daily-summary.types";
import { bestIdeas } from "@/modules/tracking/scheduler.service";
import { SUMMARY_FIXTURE } from "./fixtures/daily-summary.fixture";

// Long dashes, smart quotes, ellipsis and invisible / no-break spaces.
const TYPOGRAPHIC =
	/[\u2013\u2014\u2015\u2018\u2019\u201A\u201C\u201D\u201E\u2026\u00A0\u202F\u00AD\u200B-\u200D\u2060\uFEFF]/;

function mover(
	keyword: string,
	previousPosition: number | null,
	position: number | null,
	country = "pl",
): SummaryMover {
	return {
		country,
		delta:
			position !== null && previousPosition !== null
				? previousPosition - position
				: null,
		keyword,
		position,
		previousPosition,
	};
}

describe("pickMovers", () => {
	const positions = [
		mover("a", 20, 10),
		mover("b", 10, 9),
		mover("c", 5, 30),
		mover("d", 12, 14),
		mover("buzzin quiz", 40, 1),
		mover("e", null, 7),
		mover("f", 8, 8),
		mover("g", 30, 20, "us"),
	];
	const isBrand = (k: string) => k.includes("buzzin");

	it("lists the biggest gains and drops, brand terms and flat moves left out", () => {
		const { drops, gains } = pickMovers(positions, isBrand);
		expect(gains.map((g) => g.keyword)).toEqual(["a", "g", "b"]);
		expect(drops.map((d) => d.keyword)).toEqual(["c", "d"]);
	});

	it("breaks delta ties by the better position and caps the list", () => {
		const tied = [mover("x", 30, 25), mover("y", 10, 5), mover("z", 50, 45)];
		const { gains } = pickMovers(tied, () => false, 2);
		expect(gains.map((g) => g.keyword)).toEqual(["y", "x"]);
	});
});

describe("starredSummary", () => {
	it("returns null when nothing is starred", () => {
		expect(starredSummary([mover("a", 2, 1)], new Set())).toBeNull();
	});

	it("counts top 10 and lists the moved starred keywords, biggest move first", () => {
		const positions = [
			mover("quiz", 6, 4),
			mover("trivia", 3, 15),
			mover("party", 9, 9),
			mover("other", 50, 1),
		];
		const result = starredSummary(
			positions,
			new Set(["pl|quiz", "pl|trivia", "pl|party", "de|never-measured"]),
		);
		expect(result).toEqual({
			moved: [positions[1], positions[0]],
			top10: 2,
			total: 4,
		});
	});
});

describe("strongestMarkets", () => {
	it("orders by top 10, then ranked, then median, and drops empty markets", () => {
		const markets = [
			{
				country: "us",
				earnedMedianPosition: 20,
				earnedRanked: 30,
				earnedTop10: 4,
			},
			{
				country: "pl",
				earnedMedianPosition: 9,
				earnedRanked: 38,
				earnedTop10: 12,
			},
			{
				country: "de",
				earnedMedianPosition: 15,
				earnedRanked: 30,
				earnedTop10: 4,
			},
			{
				country: "cz",
				earnedMedianPosition: 11,
				earnedRanked: 31,
				earnedTop10: 4,
			},
			{
				country: "fr",
				earnedMedianPosition: null,
				earnedRanked: 0,
				earnedTop10: 0,
			},
		];
		expect(strongestMarkets(markets).map((m) => m.country)).toEqual([
			"pl",
			"cz",
			"de",
		]);
	});
});

describe("summarizeTotals", () => {
	it("adds the per-app counts", () => {
		expect(summarizeTotals(SUMMARY_FIXTURE.apps)).toEqual(
			SUMMARY_FIXTURE.totals,
		);
	});
});

describe("bestIdeas", () => {
	it("keeps the highest-opportunity scores without errors", () => {
		const score = (keyword: string, opportunity: number, error?: string) =>
			({ country: "pl", error, keyword, opportunity }) as Parameters<
				typeof bestIdeas
			>[0][number];
		expect(
			bestIdeas([
				score("a", 10),
				score("b", 80),
				score("c", 90, "store refused"),
				score("d", 55),
				score("e", 60),
			]).map((i) => i.keyword),
		).toEqual(["b", "e", "d"]);
	});
});

describe("buildDailySummaryEmail", () => {
	const message = buildDailySummaryEmail(SUMMARY_FIXTURE);

	it("puts the date and the headline number in the subject", () => {
		expect(message.subject).toBe(
			"AppBoard daily summary, Wed 4 Nov: 23 in top 10 across 2 apps",
		);
	});

	it("renders every app with counts, movers, starred, markets and research", () => {
		expect(message.text).toContain(
			"2 apps: 360 keywords tracked, 100 ranked, 23 in top 10. Since the previous check: 16 up, 10 down.",
		);
		expect(message.text).toContain("Buzzin - TV Show (App Store)");
		expect(message.text).toContain(
			"Tracked 320, ranked 96, top 10: 21 (without the app name).",
		);
		expect(message.text).toContain("gry na impreze [PL] #14 -> #6 (+8)");
		expect(message.text).toContain("quiz spiel [DE] #20 -> #31 (-11)");
		expect(message.text).toContain("Starred: 3 of 5 in top 10.");
		expect(message.text).toContain(
			"Strongest markets: PL 12 in top 10 / 38 ranked, median #9; CZ 5 in top 10 / 20 ranked, median #12.5; US 1 in top 10 / 15 ranked, median #27.",
		);
		expect(message.text).toContain(
			"Auto-research 4 Nov, PL: rating 4.62, 120 reviews analysed, 8% negative.",
		);
		expect(message.text).toContain(
			"23 new keyword ideas scored in 9 markets. Best by opportunity: quiz na impreze [PL] 72, partyspiel tv [DE] 64.",
		);
		expect(message.text).toContain("Buzzin <TV> (Google Play, TV)");
		expect(message.text).toContain(
			"Dashboard: https://app.appboard.dev/apps/3aae8de7-0000-4000-8000-000000000003/dashboard",
		);
		expect(message.html).toContain(
			'href="https://app.appboard.dev/apps/6d02da86-0000-4000-8000-000000000001/dashboard"',
		);
	});

	it("never ships typographic characters, even from stored model text", () => {
		expect(TYPOGRAPHIC.test(message.text)).toBe(false);
		expect(TYPOGRAPHIC.test(message.html)).toBe(false);
		expect(TYPOGRAPHIC.test(message.subject)).toBe(false);
		expect(message.text).toContain(
			'Players love the quiz rounds - the main complaint is "pairing" the phone with the TV...',
		);
	});

	it("escapes app names in the HTML", () => {
		expect(message.html).toContain("Buzzin &lt;TV&gt;");
		expect(message.html).not.toContain("<TV>");
	});

	it("keeps the template sources free of typographic characters", () => {
		for (const file of [
			"src/modules/daily-summary/daily-summary.builder.ts",
			"src/modules/daily-summary/daily-summary.service.ts",
			"src/modules/daily-summary/daily-summary.types.ts",
		]) {
			expect(TYPOGRAPHIC.test(readFileSync(file, "utf8"))).toBe(false);
		}
	});

	it("says so instead of inventing numbers for a store record without rankings", () => {
		const tvos = buildDailySummaryEmail({
			...SUMMARY_FIXTURE,
			apps: [
				{
					...SUMMARY_FIXTURE.apps[1],
					gains: [],
					platform: "ios",
					rankTrackingSupported: false,
				},
			],
		});
		expect(tvos.text).toContain(
			"Rankings cannot be measured for this store record.",
		);
		expect(tvos.text).not.toContain("Tracked 40");
	});

	it("leaves the idea line out for runs recorded before ideas were stored", () => {
		const research = SUMMARY_FIXTURE.apps[0].research;
		if (!research) throw new Error("fixture needs research");
		const old = buildDailySummaryEmail({
			...SUMMARY_FIXTURE,
			apps: [
				{
					...SUMMARY_FIXTURE.apps[0],
					research: { ...research, ideaMarkets: null, ideasScored: null },
				},
			],
		});
		expect(old.text).not.toContain("keyword idea");
		expect(old.text).toContain("Auto-research 4 Nov, PL");
	});

	it("asciiText maps typographic punctuation to ASCII", () => {
		expect(
			asciiText("a\u2014b \u201Cc\u201D \u2018d\u2019 e\u2026\u00A0f"),
		).toBe("a-b \"c\" 'd' e... f");
	});
});

import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { researchController } from "@/modules/research";
import {
	calcOpportunity,
	calculateDifficulty,
	classifyKeyword,
	difficultyLabel,
	estimateDownloads,
	estimatePopularity,
} from "@/modules/research/keyword-scoring";
import type { KeywordCompetitor } from "@/modules/research/research.types";
import { errorHandler } from "@/utils/errors/errorHandler";
import { authGuard, authRequest } from "./setup";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(researchController));

const NOW = new Date("2026-08-30T00:00:00Z");

let idCounter = 0;
function comp(overrides: Partial<KeywordCompetitor> = {}): KeywordCompetitor {
	idCounter++;
	return {
		developer: `Dev ${idCounter}`,
		genre: "Productivity",
		rating: 4.5,
		ratingsCount: 50_000,
		released: "2019-01-01T00:00:00Z",
		title: `App ${idCounter}`,
		trackId: String(idCounter),
		...overrides,
	};
}

/** A crowded market: 10 strong apps all targeting the keyword in the title. */
function strongMarket(keyword: string): KeywordCompetitor[] {
	return Array.from({ length: 10 }, (_, i) =>
		comp({
			developer: `Publisher ${i}`,
			ratingsCount: 200_000 - i * 10_000,
			title: `${keyword} - App ${i}`,
		}),
	);
}

/** A backfill market: weak #1, giant unrelated apps behind it. */
function backfillMarket(): KeywordCompetitor[] {
	return [
		comp({ ratingsCount: 40, title: "Lan Invoice Tool" }),
		...Array.from({ length: 9 }, (_, i) =>
			comp({
				developer: `BigCo ${i}`,
				ratingsCount: 500_000,
				title: `Giant Unrelated ${i}`,
			}),
		),
	];
}

describe("estimatePopularity", () => {
	it("returns null with no competitors", () => {
		expect(estimatePopularity([], "foo")).toBeNull();
	});

	it("scores a strong optimized market well above a weak niche one", () => {
		const strong = estimatePopularity(strongMarket("fitness"), "fitness");
		const weak = estimatePopularity(
			[comp({ ratingsCount: 12, title: "Obscure Thing" })],
			"obscure niche tool",
		);
		expect(strong).not.toBeNull();
		expect(weak).not.toBeNull();
		expect((strong as number) > (weak as number)).toBe(true);
		expect(strong).toBeGreaterThanOrEqual(40);
	});

	it("penalizes long-tail keywords vs the same market single-word", () => {
		const competitors = strongMarket("fitness");
		const short = estimatePopularity(competitors, "fitness");
		const longTail = estimatePopularity(
			competitors,
			"fitness tracker for busy parents",
		);
		expect((longTail as number) < (short as number)).toBe(true);
	});

	it("stays within the 1-100 scale", () => {
		const score = estimatePopularity(
			strongMarket("chat").map((c) => ({ ...c, ratingsCount: 10_000_000 })),
			"chat",
		);
		expect(score).toBeGreaterThanOrEqual(1);
		expect(score).toBeLessThanOrEqual(100);
	});
});

describe("calculateDifficulty", () => {
	it("returns 0 / no-data for an empty market", () => {
		const d = calculateDifficulty([], "foo", NOW);
		expect(d.score).toBe(0);
		expect(d.label).toBe("no-data");
		expect(d.tiers.top5.totalApps).toBe(0);
	});

	it("scores a strong optimized market as hard", () => {
		const d = calculateDifficulty(strongMarket("fitness"), "fitness", NOW);
		expect(d.score).toBeGreaterThanOrEqual(56);
		expect(["hard", "very-hard", "extreme"]).toContain(d.label);
		expect(d.breakdown.titleMatchCount).toBe(10);
	});

	it("caps tiny result sets regardless of app strength", () => {
		const d = calculateDifficulty(
			[
				comp({ ratingsCount: 2_000_000, title: "Giant One" }),
				comp({ ratingsCount: 1_000_000, title: "Giant Two" }),
			],
			"foo",
			NOW,
		);
		expect(d.score).toBeLessThanOrEqual(20);
		expect(d.breakdown.overrideReason).toBe("smallResultSet");
	});

	it("applies weak-leader / backfill corrections to padded results", () => {
		const d = calculateDifficulty(backfillMarket(), "lan invoice", NOW);
		expect(d.score).toBeLessThanOrEqual(40);
		expect(d.breakdown.overrideReason).not.toBeNull();
		expect(d.score).toBeLessThan(d.breakdown.rawTotal);
	});

	it("detects brand keywords and skips the weak-leader cap", () => {
		const brandMarket: KeywordCompetitor[] = [
			comp({
				developer: "Spotify AB",
				ratingsCount: 25_000_000,
				title: "Spotify: Music and Podcasts",
			}),
			...Array.from({ length: 9 }, () => comp({ ratingsCount: 100_000 })),
		];
		const d = calculateDifficulty(brandMarket, "spotify", NOW);
		expect(d.breakdown.isBrandKeyword).toBe(true);
		expect(d.breakdown.brandName).toBe("Spotify AB");
	});

	it("keeps tiers monotonic and floored at the overall score", () => {
		const d = calculateDifficulty(strongMarket("fitness"), "fitness", NOW);
		const { top5, top10, top20 } = d.tiers;
		expect(top5.tierScore).toBeGreaterThanOrEqual(top10.tierScore);
		expect(top10.tierScore).toBeGreaterThanOrEqual(top20.tierScore);
		expect(top20.tierScore).toBeGreaterThanOrEqual(d.score);
	});

	it("reports tier stats (weakest app, weak and fresh counts)", () => {
		const market = [
			...strongMarket("fitness").slice(0, 4),
			comp({
				ratingsCount: 300,
				released: "2026-03-01T00:00:00Z",
				title: "Fresh Fitness Indie",
			}),
		];
		const d = calculateDifficulty(market, "fitness", NOW);
		expect(d.tiers.top5.weakestApp).toBe("Fresh Fitness Indie");
		expect(d.tiers.top5.minReviews).toBe(300);
		expect(d.tiers.top5.weakCount).toBe(1);
		expect(d.tiers.top5.freshCount).toBe(1);
	});
});

describe("classifyKeyword + calcOpportunity", () => {
	it("classifies the canonical quadrants", () => {
		expect(classifyKeyword(80, 20)).toBe("sweet-spot");
		expect(classifyKeyword(30, 20)).toBe("hidden-gem");
		expect(classifyKeyword(10, 20)).toBe("low-volume");
		expect(classifyKeyword(80, 90)).toBe("high-competition");
		expect(classifyKeyword(null, 50)).toBe("unknown");
	});

	it("difficulty 100 always yields 0 opportunity", () => {
		expect(calcOpportunity(100, 100)).toBe(0);
	});

	it("opportunity grows with popularity and shrinks with difficulty", () => {
		expect(calcOpportunity(80, 20)).toBeGreaterThan(calcOpportunity(40, 20));
		expect(calcOpportunity(80, 20)).toBeGreaterThan(calcOpportunity(80, 70));
		expect(calcOpportunity(0, 10)).toBe(0);
		expect(calcOpportunity(null, 10)).toBe(0);
	});
});

describe("difficultyLabel", () => {
	it("maps score bands to labels", () => {
		expect(difficultyLabel(10)).toBe("very-easy");
		expect(difficultyLabel(35)).toBe("easy");
		expect(difficultyLabel(55)).toBe("moderate");
		expect(difficultyLabel(75)).toBe("hard");
		expect(difficultyLabel(90)).toBe("very-hard");
		expect(difficultyLabel(99)).toBe("extreme");
	});
});

describe("estimateDownloads", () => {
	it("returns zeroed estimates for missing popularity", () => {
		const est = estimateDownloads(null, "us");
		expect(est.dailySearches).toBe(0);
		expect(est.tiers.top5.high).toBe(0);
	});

	it("models 20 positions with decaying tap-through", () => {
		const est = estimateDownloads(70, "us");
		expect(est.positions).toHaveLength(20);
		expect(est.positions[0].position).toBe(1);
		expect(est.positions[0].ttr).toBe(30);
		expect(est.positions[0].high).toBeGreaterThan(est.positions[19].high);
		expect(est.tiers.top5.high).toBeGreaterThan(est.tiers.top11to20.high);
		expect(est.positions[0].low).toBeLessThan(est.positions[0].high);
	});

	it("scales search volume by market size (us > pl > unknown)", () => {
		const us = estimateDownloads(70, "us").dailySearches;
		const pl = estimateDownloads(70, "pl").dailySearches;
		const unknown = estimateDownloads(70, "zz").dailySearches;
		expect(us).toBeGreaterThan(pl);
		expect(pl).toBeGreaterThan(unknown);
	});
});

describe("POST /research/keyword-scores (auth + validation)", () => {
	it("rejects unauthenticated requests", async () => {
		const res = await app.handle(
			new Request("http://localhost/api/research/keyword-scores", {
				body: JSON.stringify({ country: "us", keywords: ["fitness"] }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(401);
	});

	it("rejects an empty keyword list", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/research/keyword-scores", {
				body: JSON.stringify({ country: "us", keywords: [] }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(422);
	});

	it("rejects more than 10 keywords", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/research/keyword-scores", {
				body: JSON.stringify({
					country: "us",
					keywords: Array.from({ length: 11 }, (_, i) => `kw${i}`),
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(422);
	});
});

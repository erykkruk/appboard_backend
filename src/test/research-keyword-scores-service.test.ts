import { afterEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { researchController } from "@/modules/research";
import { ResearchService } from "@/modules/research/research.service";
import type { KeywordScore } from "@/modules/research/research.types";
import { errorHandler } from "@/utils/errors/errorHandler";
import { authGuard, authRequest } from "./setup";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(researchController));

/** One iTunes search result in the raw API shape the client parses. */
function itunesResult(i: number, term: string) {
	return {
		artworkUrl60: `https://icon/${i}.png`,
		averageUserRating: 4.5,
		formattedPrice: "Free",
		primaryGenreName: "Productivity",
		releaseDate: "2019-01-01T00:00:00Z",
		sellerName: `Publisher ${i}`,
		trackId: 1000 + i,
		trackName: `${term} - App ${i}`,
		trackViewUrl: `https://apps.apple.com/us/app/id${1000 + i}`,
		userRatingCount: 200_000 - i * 10_000,
	};
}

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

/**
 * Stub the iTunes Search API. `handler` receives the parsed term and limit
 * and returns the results array (or throws / returns a non-200 response).
 */
function stubItunes(
	handler: (term: string, limit: number) => unknown[] | Response,
) {
	const calls: Array<{ term: string; limit: number }> = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = new URL(
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url,
		);
		const term = url.searchParams.get("term") ?? "";
		const limit = Number(url.searchParams.get("limit") ?? "0");
		calls.push({ limit, term });
		const results = handler(term, limit);
		if (results instanceof Response) return results;
		return new Response(JSON.stringify({ results }), {
			headers: { "content-type": "application/json" },
			status: 200,
		});
	}) as typeof fetch;
	return calls;
}

describe("ResearchService.keywordScores", () => {
	it("dedupes, trims and lowercases keywords", async () => {
		const calls = stubItunes((term) => [itunesResult(0, term)]);
		const scores = await ResearchService.keywordScores(
			["  Fitness ", "fitness", "FITNESS", "yoga"],
			"us",
		);
		expect(scores.map((s) => s.keyword)).toEqual(["fitness", "yoga"]);
		expect(calls.filter((c) => c.limit === 25)).toHaveLength(2);
	});

	it("caps the batch at 10 keywords", async () => {
		stubItunes((term) => [itunesResult(0, term)]);
		const scores = await ResearchService.keywordScores(
			Array.from({ length: 15 }, (_, i) => `kw${i}`),
			"us",
		);
		expect(scores).toHaveLength(10);
	}, 15_000);

	it("scores each keyword with the full result shape", async () => {
		stubItunes((term) =>
			Array.from({ length: 25 }, (_, i) => itunesResult(i, term)),
		);
		const [score] = await ResearchService.keywordScores(["fitness"], "us");

		expect(score.error).toBeUndefined();
		expect(score.country).toBe("us");
		expect(score.popularity).toBeGreaterThanOrEqual(40);
		expect(score.difficulty).toBeGreaterThan(0);
		expect(score.difficultyLabel).toMatch(
			/^(very-easy|easy|moderate|hard|very-hard|extreme)$/,
		);
		expect(score.opportunity).toBeGreaterThanOrEqual(0);
		expect(score.classification).not.toBe("unknown");
		expect(score.breakdown.titleMatchCount).toBeGreaterThan(0);
		expect(score.tiers.top5.totalApps).toBe(5);
		expect(score.tiers.top20.totalApps).toBe(20);
		expect(score.downloads.positions).toHaveLength(20);
		// Scoring runs on all 25 competitors but the payload returns 10.
		expect(score.competitors).toHaveLength(10);
		expect(score.appRank).toBeUndefined();
	});

	it("reports the app rank when an appstoreId is given", async () => {
		stubItunes((term, limit) =>
			Array.from({ length: limit === 25 ? 10 : 50 }, (_, i) =>
				itunesResult(i, term),
			),
		);
		// Rank lookup searches top 50; trackId 1003 sits at position 4.
		const [score] = await ResearchService.keywordScores(
			["fitness"],
			"us",
			"1003",
		);
		expect(score.appRank).toBe(4);
	});

	it("keeps scoring the batch when one keyword fails", async () => {
		stubItunes((term) => {
			if (term === "broken") return new Response("oops", { status: 503 });
			return Array.from({ length: 10 }, (_, i) => itunesResult(i, term));
		});
		const scores = await ResearchService.keywordScores(
			["fitness", "broken", "yoga"],
			"us",
		);
		expect(scores).toHaveLength(3);
		expect(scores[0].error).toBeUndefined();
		expect(scores[1].error).toBeDefined();
		expect(scores[1].popularity).toBeNull();
		expect(scores[1].difficulty).toBe(0);
		expect(scores[1].classification).toBe("unknown");
		expect(scores[2].error).toBeUndefined();
	});

	it("returns an empty-market score for a keyword with no results", async () => {
		stubItunes(() => []);
		const [score] = await ResearchService.keywordScores(["zxqjv"], "us");
		expect(score.error).toBeUndefined();
		expect(score.popularity).toBeNull();
		expect(score.difficulty).toBe(0);
		expect(score.difficultyLabel).toBe("no-data");
		expect(score.competitors).toHaveLength(0);
		expect(score.downloads.dailySearches).toBe(0);
	});
});

describe("POST /research/keyword-scores (end to end, stubbed iTunes)", () => {
	it("returns scores through the authenticated endpoint", async () => {
		stubItunes((term) =>
			Array.from({ length: 25 }, (_, i) => itunesResult(i, term)),
		);
		const res = await app.handle(
			authRequest("http://localhost/api/research/keyword-scores", {
				body: JSON.stringify({ country: "us", keywords: ["fitness"] }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { scores: KeywordScore[] };
		expect(body.scores).toHaveLength(1);
		expect(body.scores[0].keyword).toBe("fitness");
		expect(body.scores[0].popularity).not.toBeNull();
		expect(body.scores[0].competitors.length).toBeGreaterThan(0);
	});
});

import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { researchController } from "@/modules/research";
import {
	KEYWORD_SCORE_CACHE_TTL_DAYS,
	KeywordScoreCacheService,
} from "@/modules/research/keyword-score-cache.service";
import { ResearchService } from "@/modules/research/research.service";
import type { KeywordScore } from "@/modules/research/research.types";
import { db } from "@/utils/db";
import { keywordScoreCache, keywordScoreSnapshots } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
import {
	authGuard,
	authRequest,
	authRequestB,
	getTestWorkspaceId,
	getTestWorkspaceIdB,
} from "./setup";
import { clearKeywordScoreCache } from "./test-helpers";

/** A storefront no other suite scores in. */
const COUNTRY = "lu";
const DAY_MS = 24 * 60 * 60 * 1000;
const OWN_TRACK_ID = "1003";
const WS_A = getTestWorkspaceId();
const WS_B = getTestWorkspaceIdB();

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(researchController));

function itunesResult(i: number, term: string) {
	return {
		averageUserRating: 4.5,
		primaryGenreName: "Games",
		releaseDate: "2019-01-01T00:00:00Z",
		sellerName: `Publisher ${i}`,
		trackId: 1000 + i,
		trackName: `${term} - App ${i}`,
		userRatingCount: 200_000 - i * 10_000,
	};
}

interface StoreCall {
	limit: number;
	term: string;
}

const originalFetch = globalThis.fetch;

/** Stub iTunes Search: 25 competitors, our app (1003) at #4. */
function stubItunes(): StoreCall[] {
	const calls: StoreCall[] = [];
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
		const results = Array.from({ length: 25 }, (_, i) => itunesResult(i, term));
		return new Response(JSON.stringify({ results }), {
			headers: { "content-type": "application/json" },
			status: 200,
		});
	}) as typeof fetch;
	return calls;
}

const searches = (calls: StoreCall[]) => calls.filter((c) => c.limit === 25);
const rankSearches = (calls: StoreCall[]) =>
	calls.filter((c) => c.limit !== 25);

async function scoreVia(
	request: typeof authRequest,
	body: Record<string, unknown>,
): Promise<KeywordScore[]> {
	const res = await app.handle(
		request("http://localhost/api/research/keyword-scores", {
			body: JSON.stringify({ country: COUNTRY, ...body }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	expect(res.status).toBe(200);
	return ((await res.json()) as { scores: KeywordScore[] }).scores;
}

async function clearSnapshots() {
	await db
		.delete(keywordScoreSnapshots)
		.where(
			and(
				inArray(keywordScoreSnapshots.workspaceId, [WS_A, WS_B]),
				eq(keywordScoreSnapshots.country, COUNTRY),
			),
		);
}

beforeEach(async () => {
	await clearKeywordScoreCache();
	await clearSnapshots();
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

afterAll(async () => {
	await clearSnapshots();
	await clearKeywordScoreCache();
});

describe("keyword score cache", () => {
	it("asks the store on a miss and serves the next request from the cache", async () => {
		const calls = stubItunes();
		const [first] = await ResearchService.keywordScores(["Fitness "], COUNTRY);
		expect(searches(calls)).toHaveLength(1);
		expect(first.cached).toBe(false);
		expect(first.scoredAt).toBeDefined();

		const [second] = await ResearchService.keywordScores(["fitness"], COUNTRY);
		// A fresh hit costs no App Store call at all.
		expect(calls).toHaveLength(1);
		expect(second.cached).toBe(true);
		expect(second.scoredAt).toBe(first.scoredAt);
		// Same numbers whether measured now or served from the cache.
		expect(second.difficulty).toBe(first.difficulty);
		expect(second.popularity).toBe(first.popularity);
		expect(second.tiers).toEqual(first.tiers);
		expect(second.competitors).toHaveLength(10);
	});

	it("asks the store again once the entry is older than the TTL", async () => {
		const calls = stubItunes();
		const old = new Date(
			Date.now() - (KEYWORD_SCORE_CACHE_TTL_DAYS + 1) * DAY_MS,
		);
		await KeywordScoreCacheService.put("fitness", COUNTRY, [], old);

		const [score] = await ResearchService.keywordScores(["fitness"], COUNTRY);

		expect(searches(calls)).toHaveLength(1);
		expect(score.cached).toBe(false);
		const [row] = await db
			.select({ scoredAt: keywordScoreCache.scoredAt })
			.from(keywordScoreCache)
			.where(
				and(
					eq(keywordScoreCache.keyword, "fitness"),
					eq(keywordScoreCache.country, COUNTRY),
				),
			);
		expect(row?.scoredAt.getTime()).toBeGreaterThan(old.getTime());
	});

	it("serves an entry inside the TTL without a store call", async () => {
		const calls = stubItunes();
		const recent = new Date(
			Date.now() - (KEYWORD_SCORE_CACHE_TTL_DAYS - 1) * DAY_MS,
		);
		await KeywordScoreCacheService.put("fitness", COUNTRY, [], recent);

		const [score] = await ResearchService.keywordScores(["fitness"], COUNTRY);

		expect(calls).toHaveLength(0);
		expect(score.cached).toBe(true);
		expect(score.scoredAt).toBe(recent.toISOString());
	});

	it("bypasses the cache for an explicit refresh", async () => {
		const calls = stubItunes();
		await KeywordScoreCacheService.put("fitness", COUNTRY, []);

		const [score] = await ResearchService.keywordScores(
			["fitness"],
			COUNTRY,
			undefined,
			undefined,
			{ refresh: true },
		);

		expect(searches(calls)).toHaveLength(1);
		expect(score.cached).toBe(false);
	});
});

describe("keyword score cache across workspaces", () => {
	it("reuses workspace A's search for workspace B and writes B its own snapshot", async () => {
		const calls = stubItunes();
		await scoreVia(authRequest, { keywords: ["party game"] });
		expect(searches(calls)).toHaveLength(1);

		const [fromB] = await scoreVia(authRequestB, { keywords: ["party game"] });

		expect(searches(calls)).toHaveLength(1);
		expect(fromB.cached).toBe(true);
		const history = await app.handle(
			authRequestB(
				`http://localhost/api/research/keyword-scores/history?country=${COUNTRY}`,
			),
		);
		const { entries } = (await history.json()) as {
			entries: Array<{ day: string; id: string; keyword: string }>;
		};
		expect(entries.map((e) => e.keyword)).toEqual(["party game"]);
		expect(entries[0].day).toBe(fromB.scoredAt?.slice(0, 10) ?? "missing");
	});

	it("never leaks the asking app's rank into another workspace", async () => {
		const calls = stubItunes();
		const [fromA] = await scoreVia(authRequest, {
			appstoreId: OWN_TRACK_ID,
			keywords: ["trivia night"],
		});
		expect(fromA.appRank).toBe(4);
		expect(rankSearches(calls)).toHaveLength(1);

		const [fromB] = await scoreVia(authRequestB, {
			keywords: ["trivia night"],
		});

		expect(fromB.cached).toBe(true);
		expect(fromB.appRank).toBeUndefined();
		const [snapshotB] = await db
			.select({ appRank: keywordScoreSnapshots.appRank })
			.from(keywordScoreSnapshots)
			.where(
				and(
					eq(keywordScoreSnapshots.workspaceId, WS_B),
					eq(keywordScoreSnapshots.country, COUNTRY),
				),
			);
		expect(snapshotB?.appRank).toBeNull();
		// The cache row holds the store answer only: no rank, no workspace.
		const [row] = await db
			.select()
			.from(keywordScoreCache)
			.where(eq(keywordScoreCache.country, COUNTRY));
		expect(Object.keys(row ?? {}).sort()).toEqual([
			"competitors",
			"country",
			"createdAt",
			"id",
			"keyword",
			"scoredAt",
			"updatedAt",
		]);
	});

	it("still asks the store for the own rank on a cache hit", async () => {
		const calls = stubItunes();
		await scoreVia(authRequestB, { keywords: ["quiz show"] });

		const [fromA] = await scoreVia(authRequest, {
			appstoreId: OWN_TRACK_ID,
			keywords: ["quiz show"],
		});

		expect(fromA.cached).toBe(true);
		expect(fromA.appRank).toBe(4);
		expect(searches(calls)).toHaveLength(1);
		expect(rankSearches(calls)).toHaveLength(1);
	});

	it("keeps each workspace's history to itself", async () => {
		stubItunes();
		await scoreVia(authRequest, { keywords: ["word game"] });
		await scoreVia(authRequestB, { keywords: ["word game"] });

		const listA = await app.handle(
			authRequest(
				`http://localhost/api/research/keyword-scores/history?country=${COUNTRY}`,
			),
		);
		const { entries } = (await listA.json()) as {
			entries: Array<{ id: string }>;
		};
		expect(entries).toHaveLength(1);
		const fromB = await app.handle(
			authRequestB(
				`http://localhost/api/research/keyword-scores/history/${entries[0].id}`,
			),
		);
		expect(fromB.status).toBe(404);
	});

	it("dates a cached score's snapshot on its measurement day", async () => {
		stubItunes();
		const measured = new Date(Date.now() - 3 * DAY_MS);
		await KeywordScoreCacheService.put("board game", COUNTRY, [], measured);

		await scoreVia(authRequest, { keywords: ["board game"] });

		const [snapshot] = await db
			.select({ day: keywordScoreSnapshots.day })
			.from(keywordScoreSnapshots)
			.where(
				and(
					eq(keywordScoreSnapshots.workspaceId, WS_A),
					eq(keywordScoreSnapshots.country, COUNTRY),
					eq(keywordScoreSnapshots.keyword, "board game"),
				),
			);
		expect(snapshot?.day).toBe(measured.toISOString().slice(0, 10));
	});
});

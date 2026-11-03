import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { ResearchService } from "@/modules/research/research.service";
import {
	configureRankLookup,
	RANK_LOOKUP_MAX_ATTEMPTS,
	RANK_LOOKUP_SPACING_MS,
	RANK_LOOKUP_THROTTLE_PAUSE_MS,
	STORE_BREAKER_MAX_STALL_MS,
	throttledStoreCall,
} from "@/modules/tracking/rank-lookup";
import { runScheduledScoreRefresh } from "@/modules/tracking/scheduler.service";
import { TrackingService } from "@/modules/tracking/tracking.service";
import { cleanupStores, getTestWorkspaceId } from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { db } from "@/utils/db";
import {
	apps,
	appTrackingConfig,
	keywordScoreSnapshots,
} from "@/utils/db/schema";

/** A country no other suite scores in, so snapshot rows stay isolated. */
const COUNTRY = "nz";
const TRACK_ID = "987654321";
const KEYWORDS = ["party game", "trivia night", "quiz show"];

const storeIds: string[] = [];
let appId: string;

/** Virtual clock: sleeping advances time instantly and records every wait. */
function fakeTime() {
	let now = 5_000_000;
	const waits: number[] = [];
	return {
		now: () => now,
		sleep: async (ms: number) => {
			waits.push(ms);
			now += ms;
		},
		waits,
	};
}

interface ItunesCall {
	host: string;
	limit: number;
	term: string;
}

const originalFetch = globalThis.fetch;

/**
 * Stub iTunes Search. Our app sits at #3 in every result list. `refuse`
 * decides per call whether iTunes answers 403; other hosts (the SSR
 * fallback) always fail so a refused search surfaces to the throttle.
 */
function stubItunes(refuse: (call: ItunesCall) => boolean = () => false) {
	const calls: ItunesCall[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = new URL(
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url,
		);
		const call = {
			host: url.host,
			limit: Number(url.searchParams.get("limit") ?? "0"),
			term: url.searchParams.get("term") ?? "",
		};
		calls.push(call);
		if (call.host !== "itunes.apple.com") {
			return new Response("", { status: 404 });
		}
		if (refuse(call)) return new Response("", { status: 403 });
		const results = [1, 2, Number(TRACK_ID), 4].map((trackId, i) => ({
			averageUserRating: 4.5,
			trackId,
			trackName: `${call.term} ${i}`,
			userRatingCount: 50_000 - i * 1_000,
		}));
		return new Response(JSON.stringify({ results }), {
			headers: { "content-type": "application/json" },
			status: 200,
		});
	}) as typeof fetch;
	return calls;
}

beforeAll(async () => {
	const store = await seedTestStore();
	storeIds.push(store.id);
	const seeded = await seedTestApp(store.id);
	appId = seeded.id;
	await db
		.update(apps)
		.set({ externalId: TRACK_ID, platform: "ios" })
		.where(eq(apps.id, appId));
	await TrackingService.addKeywords(appId, COUNTRY, KEYWORDS);
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	configureRankLookup();
});

afterAll(async () => {
	await db
		.delete(keywordScoreSnapshots)
		.where(
			and(
				eq(keywordScoreSnapshots.workspaceId, getTestWorkspaceId()),
				eq(keywordScoreSnapshots.country, COUNTRY),
			),
		);
	await cleanupStores(storeIds);
});

describe("nightly keyword-score refresh", () => {
	it("sends every iTunes request through the shared store throttle", async () => {
		const time = fakeTime();
		configureRankLookup({ now: time.now, sleep: time.sleep });
		const calls = stubItunes();

		const startedAt = Date.now();
		await runScheduledScoreRefresh({
			appId,
			workspaceId: getTestWorkspaceId(),
		});
		const elapsedMs = Date.now() - startedAt;

		// One competitor search (top 25) and one rank search (top 200) each.
		const itunes = calls.filter((c) => c.host === "itunes.apple.com");
		expect(itunes).toHaveLength(KEYWORDS.length * 2);
		// Every request after the first waited one App Store slot on the
		// process-wide throttle, the same spacing rank checks use.
		expect(time.waits).toEqual(
			Array(itunes.length - 1).fill(RANK_LOOKUP_SPACING_MS.appstore),
		);
		// The local 300 ms batch delay is replaced, not stacked on top.
		expect(elapsedMs).toBeLessThan(500);

		const rows = await db
			.select({
				appRank: keywordScoreSnapshots.appRank,
				keyword: keywordScoreSnapshots.keyword,
			})
			.from(keywordScoreSnapshots)
			.where(
				and(
					eq(keywordScoreSnapshots.workspaceId, getTestWorkspaceId()),
					eq(keywordScoreSnapshots.country, COUNTRY),
				),
			);
		expect(rows.map((r) => r.keyword).sort()).toEqual([...KEYWORDS].sort());
		expect(rows.every((r) => r.appRank === 3)).toBe(true);
	});

	it("retries a 403 under the throttle and slows the store down", async () => {
		const time = fakeTime();
		const rt = configureRankLookup({ now: time.now, sleep: time.sleep });
		let refusedOnce = false;
		const calls = stubItunes((call) => {
			if (call.term !== "trivia night" || call.limit !== 25) return false;
			if (refusedOnce) return false;
			refusedOnce = true;
			return true;
		});

		const scores = await ResearchService.keywordScores(
			KEYWORDS,
			COUNTRY,
			TRACK_ID,
			undefined,
			{ pace: (call) => throttledStoreCall("appstore", call, rt) },
		);

		const trivia = scores.find((s) => s.keyword === "trivia night");
		expect(trivia?.error).toBeUndefined();
		expect(trivia?.appRank).toBe(3);
		expect(time.waits).toContain(RANK_LOOKUP_THROTTLE_PAUSE_MS);
		expect(rt.throttles.appstore.currentSpacingMs).toBe(
			RANK_LOOKUP_SPACING_MS.appstore * 2,
		);
		// Paced runs never fall back to the App Store web page or the lookup
		// API: that would go around the throttle and hide the 403.
		expect(calls.filter((c) => c.host !== "itunes.apple.com")).toHaveLength(0);
	});

	it("keeps scoring the batch when a rank search is refused on every try", async () => {
		const time = fakeTime();
		const rt = configureRankLookup({ now: time.now, sleep: time.sleep });
		const calls = stubItunes(
			(call) => call.term === "quiz show" && call.limit === 200,
		);

		const scores = await ResearchService.keywordScores(
			KEYWORDS,
			COUNTRY,
			TRACK_ID,
			undefined,
			{ pace: (call) => throttledStoreCall("appstore", call, rt) },
		);

		const quiz = scores.find((s) => s.keyword === "quiz show");
		expect(quiz?.error).toBeUndefined();
		expect(quiz?.appRank).toBeNull();
		expect(
			calls.filter((c) => c.term === "quiz show" && c.limit === 200),
		).toHaveLength(RANK_LOOKUP_MAX_ATTEMPTS);
		expect(scores.filter((s) => s.appRank === 3)).toHaveLength(2);
	});

	it("stops when the store stays blocked, without scoring or marking the refresh", async () => {
		const blocked = Array.from({ length: 20 }, (_, i) => `blocked term ${i}`);
		const store = await seedTestStore();
		storeIds.push(store.id);
		const seeded = await seedTestApp(store.id);
		await db
			.update(apps)
			.set({ externalId: TRACK_ID, platform: "ios" })
			.where(eq(apps.id, seeded.id));
		await TrackingService.addKeywords(seeded.id, COUNTRY, blocked);
		const time = fakeTime();
		configureRankLookup({ now: time.now, sleep: time.sleep });
		const calls = stubItunes(() => true);

		await runScheduledScoreRefresh({
			appId: seeded.id,
			workspaceId: getTestWorkspaceId(),
		});

		const itunes = calls.filter((c) => c.host === "itunes.apple.com");
		// Without the breaker: 20 keywords x 2 searches x 4 attempts = 160.
		expect(itunes.length).toBeLessThanOrEqual(2 * RANK_LOOKUP_MAX_ATTEMPTS);
		expect(calls.filter((c) => c.host !== "itunes.apple.com")).toHaveLength(0);
		// It gave up around the stall limit, not after hours of pauses.
		expect(time.waits.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(
			STORE_BREAKER_MAX_STALL_MS,
		);

		const scored = await db
			.select({ keyword: keywordScoreSnapshots.keyword })
			.from(keywordScoreSnapshots)
			.where(
				and(
					eq(keywordScoreSnapshots.workspaceId, getTestWorkspaceId()),
					eq(keywordScoreSnapshots.country, COUNTRY),
				),
			);
		expect(scored.filter((r) => blocked.includes(r.keyword))).toHaveLength(0);
		const [config] = await db
			.select({ lastScoreRefreshAt: appTrackingConfig.lastScoreRefreshAt })
			.from(appTrackingConfig)
			.where(eq(appTrackingConfig.appId, seeded.id));
		expect(config?.lastScoreRefreshAt ?? null).toBeNull();
	});
});

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { KeywordScoreCacheService } from "@/modules/research/keyword-score-cache.service";
import { ResearchService } from "@/modules/research/research.service";
import {
	configureRankLookup,
	RANK_LOOKUP_MAX_ATTEMPTS,
	RANK_LOOKUP_SPACING_MS,
	RANK_LOOKUP_THROTTLE_PAUSE_MS,
	STORE_BREAKER_MAX_STALL_MS,
	throttledStoreCall,
} from "@/modules/tracking/rank-lookup";
import {
	collectTrackedPairs,
	refreshSliceSize,
	runScoreCacheRefresh,
	SCORE_REFRESH_MIN_SLICE,
	stalePairs,
	type TrackedScorePair,
} from "@/modules/tracking/score-refresh.service";
import { TrackingService } from "@/modules/tracking/tracking.service";
import {
	cleanupStores,
	getTestWorkspaceId,
	getTestWorkspaceIdB,
} from "@/test/setup";
import {
	clearKeywordScoreCache,
	seedTestApp,
	seedTestStore,
} from "@/test/test-helpers";
import { db } from "@/utils/db";
import {
	apps,
	appTrackingConfig,
	keywordScoreCache,
	keywordScoreRefreshRuns,
	keywordScoreSnapshots,
	rankSnapshots,
} from "@/utils/db/schema";

/** A country no other suite scores in, so snapshot rows stay isolated. */
const COUNTRY = "nz";
const TRACK_ID = "987654321";
const KEYWORDS = ["party game", "trivia night", "quiz show"];
const DAY_MS = 24 * 60 * 60 * 1000;
/** Run-day keys far from any real day, one per test. */
let dayCounter = 0;
const nextDay = () => `2099-01-${String(++dayCounter).padStart(2, "0")}`;

const WS_A = getTestWorkspaceId();
const WS_B = getTestWorkspaceIdB();
const storeIds: string[] = [];
/** Workspace A: an iOS app and a second app on the same keywords. */
let iosAppId: string;
let secondAppId: string;
/** Workspace B: one app on the same keywords. */
let otherWorkspaceAppId: string;

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

async function seedTrackingApp(
	workspaceId: string,
	keywords: string[],
	options: { ios?: boolean } = {},
): Promise<string> {
	const store = await seedTestStore(workspaceId);
	storeIds.push(store.id);
	const seeded = await seedTestApp(store.id);
	if (options.ios) {
		await db
			.update(apps)
			.set({ externalId: TRACK_ID, platform: "ios" })
			.where(eq(apps.id, seeded.id));
	}
	await db
		.insert(appTrackingConfig)
		.values({ appId: seeded.id, rankTrackingEnabled: true, workspaceId });
	await TrackingService.addKeywords(seeded.id, COUNTRY, keywords);
	return seeded.id;
}

/** The tracked pairs of this suite only (the test DB is shared). */
async function suitePairs(): Promise<TrackedScorePair[]> {
	const ours = new Set([iosAppId, secondAppId, otherWorkspaceAppId]);
	return (await collectTrackedPairs())
		.filter((p) => p.country === COUNTRY)
		.map((p) => ({
			...p,
			workspaces: new Map(
				[...p.workspaces.entries()]
					.map(([ws, ids]) => [ws, ids.filter((id) => ours.has(id))] as const)
					.filter(([, ids]) => ids.length > 0),
			),
		}))
		.filter((p) => p.workspaces.size > 0);
}

function itunesCalls(calls: ItunesCall[], terms = KEYWORDS) {
	return calls.filter(
		(c) => c.host === "itunes.apple.com" && terms.includes(c.term),
	);
}

async function snapshotsOf(workspaceId: string) {
	return db
		.select({
			appRank: keywordScoreSnapshots.appRank,
			day: keywordScoreSnapshots.day,
			keyword: keywordScoreSnapshots.keyword,
		})
		.from(keywordScoreSnapshots)
		.where(
			and(
				eq(keywordScoreSnapshots.workspaceId, workspaceId),
				eq(keywordScoreSnapshots.country, COUNTRY),
			),
		);
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

beforeAll(async () => {
	iosAppId = await seedTrackingApp(WS_A, KEYWORDS, { ios: true });
	secondAppId = await seedTrackingApp(WS_A, KEYWORDS);
	otherWorkspaceAppId = await seedTrackingApp(WS_B, KEYWORDS);
	// The 00:00 rank check measured the iOS app at #3 for every keyword.
	await db.insert(rankSnapshots).values(
		KEYWORDS.map((keyword) => ({
			appId: iosAppId,
			country: COUNTRY,
			keyword,
			platform: "appstore",
			position: 3,
		})),
	);
});

beforeEach(async () => {
	await clearKeywordScoreCache();
	await clearSnapshots();
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	configureRankLookup();
});

afterAll(async () => {
	await clearSnapshots();
	await clearKeywordScoreCache();
	await cleanupStores(storeIds);
});

describe("nightly keyword-score cache refresh", () => {
	it("asks the App Store once per pair across apps and workspaces, through the throttle", async () => {
		const time = fakeTime();
		configureRankLookup({ now: time.now, sleep: time.sleep });
		const calls = stubItunes();
		const pairs = await suitePairs();
		// Three apps in two workspaces track the same three phrases.
		expect(pairs).toHaveLength(KEYWORDS.length);
		expect(pairs.every((p) => p.workspaces.size === 2)).toBe(true);

		const summary = await runScoreCacheRefresh(nextDay(), { pairs });

		// One competitor search per pair, no own-rank search (ranks come from
		// the rank check), instead of 3 apps x 3 keywords x 2 searches.
		const itunes = itunesCalls(calls);
		expect(itunes).toHaveLength(KEYWORDS.length);
		expect(itunes.every((c) => c.limit === 25)).toBe(true);
		expect(time.waits).toEqual(
			Array(itunes.length - 1).fill(RANK_LOOKUP_SPACING_MS.appstore),
		);
		expect(summary?.status).toBe("completed");
		expect(summary?.refreshed).toBe(KEYWORDS.length);

		const cached = await KeywordScoreCacheService.getMany(KEYWORDS, COUNTRY);
		expect([...cached.keys()].sort()).toEqual([...KEYWORDS].sort());

		// Both workspaces got a snapshot of the measurement; the own rank is
		// workspace A's iOS app's rank-check position, workspace B has none.
		const a = await snapshotsOf(WS_A);
		const b = await snapshotsOf(WS_B);
		expect(a.map((r) => r.keyword).sort()).toEqual([...KEYWORDS].sort());
		expect(a.every((r) => r.appRank === 3)).toBe(true);
		expect(b.map((r) => r.keyword).sort()).toEqual([...KEYWORDS].sort());
		expect(b.every((r) => r.appRank === null)).toBe(true);
	});

	it("does not ask the store for pairs whose cache entry is fresh", async () => {
		for (const keyword of KEYWORDS) {
			await KeywordScoreCacheService.put(
				keyword,
				COUNTRY,
				[],
				new Date(Date.now() - 2 * DAY_MS),
			);
		}
		configureRankLookup({ sleep: async () => {} });
		const calls = stubItunes();

		const summary = await runScoreCacheRefresh(nextDay(), {
			pairs: await suitePairs(),
		});

		expect(itunesCalls(calls)).toHaveLength(0);
		expect(summary?.target).toBe(0);
		// Workspaces still get the snapshot of the cached measurement, dated
		// on the day it was made.
		const day = new Date(Date.now() - 2 * DAY_MS).toISOString().slice(0, 10);
		const b = await snapshotsOf(WS_B);
		expect(b).toHaveLength(KEYWORDS.length);
		expect(b.every((r) => r.day === day)).toBe(true);
	});

	it("refreshes only stale entries, oldest first", async () => {
		await KeywordScoreCacheService.put(
			"party game",
			COUNTRY,
			[],
			new Date(Date.now() - 10 * DAY_MS),
		);
		await KeywordScoreCacheService.put(
			"trivia night",
			COUNTRY,
			[],
			new Date(Date.now() - DAY_MS),
		);
		configureRankLookup({ sleep: async () => {} });
		const calls = stubItunes();

		await runScoreCacheRefresh(nextDay(), { pairs: await suitePairs() });

		// Missing (quiz show) and 10 days old (party game); 1 day old stays.
		expect(
			itunesCalls(calls)
				.map((c) => c.term)
				.sort(),
		).toEqual(["party game", "quiz show"]);
	});

	it("resumes a slice a restart cut off instead of starting over", async () => {
		const day = nextDay();
		// The killed run had a slice of 3 and refreshed one pair already.
		await KeywordScoreCacheService.put("party game", COUNTRY, []);
		await db
			.insert(keywordScoreRefreshRuns)
			.values({ day, due: 3, pairs: 3, refreshed: 1, target: 3 });
		configureRankLookup({ sleep: async () => {} });
		const calls = stubItunes();

		const summary = await runScoreCacheRefresh(day, {
			pairs: await suitePairs(),
		});

		expect(summary?.resumed).toBe(true);
		expect(
			itunesCalls(calls)
				.map((c) => c.term)
				.sort(),
		).toEqual(["quiz show", "trivia night"]);
		expect(summary?.refreshed).toBe(3);
		const [run] = await db
			.select()
			.from(keywordScoreRefreshRuns)
			.where(eq(keywordScoreRefreshRuns.day, day));
		expect(run?.status).toBe("completed");
		expect(run?.finishedAt).not.toBeNull();

		// The day is done: another tick the same day asks nothing.
		const again = await runScoreCacheRefresh(day, {
			pairs: await suitePairs(),
		});
		expect(again).toBeNull();
		expect(itunesCalls(calls)).toHaveLength(2);
	});

	it("stops when the store stays blocked, without caching or completing the run", async () => {
		const day = nextDay();
		const time = fakeTime();
		configureRankLookup({ now: time.now, sleep: time.sleep });
		const calls = stubItunes(() => true);

		const summary = await runScoreCacheRefresh(day, {
			pairs: await suitePairs(),
		});

		const itunes = itunesCalls(calls);
		expect(itunes.length).toBeLessThanOrEqual(2 * RANK_LOOKUP_MAX_ATTEMPTS);
		expect(calls.filter((c) => c.host !== "itunes.apple.com")).toHaveLength(0);
		expect(time.waits.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(
			STORE_BREAKER_MAX_STALL_MS,
		);
		expect(summary?.status).toBe("failed");
		const cached = await db
			.select({ keyword: keywordScoreCache.keyword })
			.from(keywordScoreCache)
			.where(eq(keywordScoreCache.country, COUNTRY));
		expect(cached).toHaveLength(0);
		expect(await snapshotsOf(WS_A)).toHaveLength(0);
	});
});

describe("refresh slice planning", () => {
	it("takes a seventh of the tracked pairs a night, at least the minimum", () => {
		expect(refreshSliceSize(1920, 1920)).toBe(275);
		expect(refreshSliceSize(1920, 100)).toBe(100);
		expect(refreshSliceSize(70, 70)).toBe(SCORE_REFRESH_MIN_SLICE);
		expect(refreshSliceSize(10, 10)).toBe(10);
		expect(refreshSliceSize(10, 0)).toBe(0);
	});

	it("orders never-scored pairs first, then by age, and skips fresh ones", () => {
		const now = new Date("2026-11-04T01:00:00Z");
		const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
		const pairs = ["fresh", "old", "never", "older"].map((keyword) => ({
			country: "us",
			keyword,
		}));
		const scoredAt = new Map([
			["us:fresh", ago(2)],
			["us:old", ago(6.5)],
			["us:older", ago(9)],
		]);
		expect(stalePairs(pairs, scoredAt, now).map((p) => p.keyword)).toEqual([
			"never",
			"older",
			"old",
		]);
	});
});

describe("paced keywordScores", () => {
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
});

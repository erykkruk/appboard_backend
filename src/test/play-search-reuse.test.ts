import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	spyOn,
} from "bun:test";
import { asc, eq } from "drizzle-orm";
import { rankOf } from "@/modules/research/playstore.client";
import { ResearchService } from "@/modules/research/research.service";
import {
	PLAY_SEARCH_REUSE_TTL_MS,
	PlaySearchCache,
	playSearchKey,
} from "@/modules/tracking/play-search-cache";
import { RankCheckJobs } from "@/modules/tracking/rank-check.jobs";
import {
	configureRankLookup,
	lookupRank,
	STORE_BREAKER_MAX_CONSECUTIVE_FAILURES,
	STORE_THROTTLE_MAX_EVENTS,
} from "@/modules/tracking/rank-lookup";
import { trackingSchedule } from "@/modules/tracking/scheduler.service";
import { TrackingService } from "@/modules/tracking/tracking.service";
import { cleanupStores, getTestWorkspaceId } from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { db } from "@/utils/db";
import { apps, rankSnapshots } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

const COUNTRY = "pl";
const PHONE_ID = "tech.example.phone";
const TV_ID = "com.example.tv";
const RIVAL_ID = "com.rival.game";
/** One Play answer: a rival first, then the phone app, then the TV app. */
const RANKING = [RIVAL_ID, PHONE_ID, TV_ID];
const storeIds: string[] = [];
let storeId: string;

function fakeTime() {
	let now = 50_000_000;
	return {
		advance: (ms: number) => {
			now += ms;
		},
		now: () => now,
		sleep: async (ms: number) => {
			now += ms;
		},
	};
}

function storeError(status: number): unknown {
	try {
		buildError("storeApiError", { info: `HTTP ${status}`, status });
	} catch (err) {
		return err;
	}
	return null;
}

const keywordList = (n: number) =>
	Array.from({ length: n }, (_, i) => `kw ${String(i).padStart(2, "0")}`);

async function playApp(externalId: string, keywords: string[]) {
	const app = await seedTestApp(storeId);
	await db.update(apps).set({ externalId }).where(eq(apps.id, app.id));
	await TrackingService.addKeywords(app.id, COUNTRY, keywords);
	return app.id;
}

async function positions(appId: string) {
	const rows = await db
		.select({
			keyword: rankSnapshots.keyword,
			position: rankSnapshots.position,
		})
		.from(rankSnapshots)
		.where(eq(rankSnapshots.appId, appId))
		.orderBy(asc(rankSnapshots.keyword));
	return rows;
}

/** Stub the real Play search: counts calls and reports the full ranking. */
function stubPlaySearch() {
	const calls: string[] = [];
	const spy = spyOn(ResearchService, "positionFor").mockImplementation(
		async (_store, keyword, id, _country, onRanking) => {
			calls.push(keyword);
			onRanking?.(RANKING);
			return rankOf(RANKING, id);
		},
	);
	return { calls, spy };
}

beforeAll(async () => {
	const store = await seedTestStore();
	storeId = store.id;
	storeIds.push(store.id);
});

afterEach(() => {
	configureRankLookup();
});

afterAll(async () => {
	await cleanupStores(storeIds);
});

describe("PlaySearchCache", () => {
	it("answers the same keyword and country until the TTL ends", () => {
		const time = fakeTime();
		const cache = new PlaySearchCache(time.now);
		cache.set("Quiz ", "PL", RANKING);

		expect(cache.get("quiz", "pl")).toEqual(RANKING);
		expect(cache.get("quiz", "de")).toBeNull();
		time.advance(PLAY_SEARCH_REUSE_TTL_MS);
		expect(cache.get("quiz", "pl")).toBeNull();
		expect(cache.size).toBe(0);
	});

	it("keys by keyword, country and the language Play is asked in", () => {
		expect(playSearchKey("quiz", "us")).toBe(playSearchKey(" QUIZ", "US"));
		expect(playSearchKey("quiz", "us")).not.toBe(playSearchKey("quiz", "gb"));
		expect(playSearchKey("quiz", "us")).toContain("en");
	});

	it("drops the oldest entries past the size cap", () => {
		const time = fakeTime();
		const cache = new PlaySearchCache(time.now, PLAY_SEARCH_REUSE_TTL_MS, 2);
		cache.set("a", "pl", ["x"]);
		time.advance(1);
		cache.set("b", "pl", ["y"]);
		time.advance(1);
		cache.set("c", "pl", ["z"]);

		expect(cache.size).toBe(2);
		expect(cache.get("a", "pl")).toBeNull();
		expect(cache.get("c", "pl")).toEqual(["z"]);
	});
});

describe("lookupRank with a shared Play search", () => {
	it("reuses a search without a request or a throttle slot", async () => {
		const time = fakeTime();
		let calls = 0;
		const rt = configureRankLookup({
			fetchPosition: async () => {
				calls++;
				return 1;
			},
			now: time.now,
			sleep: time.sleep,
		});
		rt.playSearches.set("quiz", COUNTRY, RANKING);
		const slotBefore = rt.throttles.playstore.nextSlotTime();

		const outcome = await lookupRank(
			"playstore",
			"quiz",
			TV_ID,
			COUNTRY,
			rt,
			undefined,
			{ reuseSearch: true },
		);

		expect(outcome).toEqual({
			attempts: 0,
			ok: true,
			position: 3,
			reused: true,
		});
		expect(calls).toBe(0);
		expect(rt.throttles.playstore.nextSlotTime()).toBe(slotBefore);
	});

	it("asks the store when reuse is off, and never reuses for the App Store", async () => {
		let calls = 0;
		const rt = configureRankLookup({
			fetchPosition: async () => {
				calls++;
				return 7;
			},
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
		});
		rt.playSearches.set("quiz", COUNTRY, RANKING);

		await lookupRank("playstore", "quiz", TV_ID, COUNTRY, rt);
		await lookupRank("appstore", "quiz", "1", COUNTRY, rt, undefined, {
			reuseSearch: true,
		});

		expect(calls).toBe(2);
	});
});

describe("scheduled Play checks share one search per keyword", () => {
	it("measures phone and TV apps with one store call per keyword", async () => {
		const keywords = keywordList(3);
		const phone = await playApp(PHONE_ID, keywords);
		const tv = await playApp(TV_ID, keywords);
		configureRankLookup({
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
		});
		const { calls, spy } = stubPlaySearch();

		await RankCheckJobs.start(phone, getTestWorkspaceId(), "scheduled");
		await RankCheckJobs.start(tv, getTestWorkspaceId(), "scheduled");
		await Promise.all([
			RankCheckJobs.waitFor(phone),
			RankCheckJobs.waitFor(tv),
		]);
		spy.mockRestore();

		expect(calls).toEqual(keywords);
		expect((await positions(phone)).map((p) => p.position)).toEqual([2, 2, 2]);
		expect((await positions(tv)).map((p) => p.position)).toEqual([3, 3, 3]);
		const runs = await Promise.all([
			RankCheckJobs.latest(phone, getTestWorkspaceId()),
			RankCheckJobs.latest(tv, getTestWorkspaceId()),
		]);
		expect(runs.map((r) => [r?.status, r?.measured])).toEqual([
			["completed", 3],
			["completed", 3],
		]);
	});

	it("searches only the keywords the other app does not track", async () => {
		const phone = await playApp(PHONE_ID, ["alpha", "beta"]);
		const tv = await playApp(TV_ID, ["beta", "gamma"]);
		configureRankLookup({
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
		});
		const { calls, spy } = stubPlaySearch();

		await RankCheckJobs.start(phone, getTestWorkspaceId(), "scheduled");
		await RankCheckJobs.start(tv, getTestWorkspaceId(), "scheduled");
		await Promise.all([
			RankCheckJobs.waitFor(phone),
			RankCheckJobs.waitFor(tv),
		]);
		spy.mockRestore();

		expect([...calls].sort()).toEqual(["alpha", "beta", "gamma"]);
	});

	it("manual checks still ask the store for every keyword", async () => {
		const keywords = keywordList(2);
		const phone = await playApp(PHONE_ID, keywords);
		const tv = await playApp(TV_ID, keywords);
		configureRankLookup({
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
		});
		const { calls, spy } = stubPlaySearch();

		await RankCheckJobs.start(phone, getTestWorkspaceId(), "scheduled");
		await RankCheckJobs.waitFor(phone);
		await RankCheckJobs.start(tv, getTestWorkspaceId(), "manual");
		await RankCheckJobs.waitFor(tv);
		spy.mockRestore();

		expect(calls).toHaveLength(4);
		expect((await positions(tv)).map((p) => p.position)).toEqual([3, 3]);
	});

	it("a reused answer does not reset the breaker's failure streak", async () => {
		const keywords = keywordList(20);
		const tv = await playApp(TV_ID, keywords);
		const time = fakeTime();
		const rt = configureRankLookup({
			fetchPosition: async () => {
				throw storeError(503);
			},
			now: time.now,
			sleep: time.sleep,
		});
		// Every even keyword was already searched by another app.
		for (const [i, keyword] of keywords.entries()) {
			if (i % 2 === 0) rt.playSearches.set(keyword, COUNTRY, RANKING);
		}

		await RankCheckJobs.start(tv, getTestWorkspaceId(), "scheduled");
		await RankCheckJobs.waitFor(tv);

		const run = await RankCheckJobs.latest(tv, getTestWorkspaceId());
		expect(run?.status).toBe("failed");
		expect(run?.error).toContain(
			`${STORE_BREAKER_MAX_CONSECUTIVE_FAILURES} lookups in a row failed`,
		);
		expect(run?.failed).toBe(STORE_BREAKER_MAX_CONSECUTIVE_FAILURES);
		// Reused answers before the 8th store failure are kept as measurements.
		expect(run?.measured).toBe(STORE_BREAKER_MAX_CONSECUTIVE_FAILURES);
	});
});

describe("a Play app queued behind a throttled one", () => {
	it("is deferred without a store call instead of failing with 0 checked", async () => {
		const keywords = keywordList(6);
		const phone = await playApp(PHONE_ID, keywords);
		const tv = await playApp(TV_ID, keywords);
		const time = fakeTime();
		const callsFor: Record<string, number> = {};
		const rt = configureRankLookup({
			fetchPosition: async (_store, _keyword, id) => {
				callsFor[id] = (callsFor[id] ?? 0) + 1;
				throw storeError(429);
			},
			now: time.now,
			sleep: time.sleep,
		});

		await RankCheckJobs.start(phone, getTestWorkspaceId(), "scheduled");
		// The phone run holds the Play queue before the TV run joins it.
		while (rt.runs.depth("playstore") === 0) await Bun.sleep(1);
		await RankCheckJobs.start(tv, getTestWorkspaceId(), "scheduled");
		await Promise.all([
			RankCheckJobs.waitFor(phone),
			RankCheckJobs.waitFor(tv),
		]);

		const phoneRun = await RankCheckJobs.latest(phone, getTestWorkspaceId());
		const tvRun = await RankCheckJobs.latest(tv, getTestWorkspaceId());
		// The breaker still stops the first run on the third throttle answer.
		expect(phoneRun?.status).toBe("failed");
		expect(phoneRun?.error).toContain(
			`${STORE_THROTTLE_MAX_EVENTS} throttle answers in 30 min`,
		);
		expect(callsFor[PHONE_ID]).toBe(STORE_THROTTLE_MAX_EVENTS);
		// The queued run never asked the store and says why.
		expect(callsFor[TV_ID]).toBeUndefined();
		expect(tvRun?.status).toBe("interrupted");
		expect(tvRun?.error).toStartWith("Deferred:");
		expect(tvRun?.error).toContain("next scheduled check");
		expect(tvRun?.checked).toBe(0);
		expect(tvRun?.failed).toBe(0);
		expect(RankCheckJobs.isRunning(tv)).toBe(false);
	});
});

describe("an interrupted check resumes with the keywords it missed", () => {
	it("the next scheduled run measures only the keywords it missed", async () => {
		const keywords = keywordList(10);
		const appId = await playApp(PHONE_ID, keywords);
		const time = fakeTime();
		let answered = 0;
		configureRankLookup({
			fetchPosition: async () => {
				if (answered >= 4) throw storeError(429);
				answered++;
				return 5;
			},
			now: time.now,
			sleep: time.sleep,
		});
		await RankCheckJobs.start(appId, getTestWorkspaceId(), "scheduled");
		await RankCheckJobs.waitFor(appId);
		const first = await RankCheckJobs.latest(appId, getTestWorkspaceId());
		expect(first?.status).toBe("failed");
		expect(first?.measured).toBe(4);

		// Snapshots of the first run are older than the next run's start.
		const looked: string[] = [];
		configureRankLookup({
			fetchPosition: async (_store, keyword) => {
				looked.push(keyword);
				return 5;
			},
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
		});
		await RankCheckJobs.start(appId, getTestWorkspaceId(), "scheduled");
		await RankCheckJobs.waitFor(appId);

		// The 4 keywords measured minutes ago are inside the Play fresh window.
		expect(looked).toEqual(keywords.slice(4));
	});
});

describe("tracking schedule per store", () => {
	const cfg = {
		autoResearchEnabled: false,
		autoResearchFrequency: "weekly",
		lastAutoResearchAt: null,
	};

	it("shows 00:00 + the 03:00 catch-up for Google Play, two slots for the App Store", () => {
		expect(trackingSchedule(cfg, "playstore").rankCheckHours).toEqual([0, 3]);
		expect(trackingSchedule(cfg, "appstore").rankCheckHours).toEqual([0, 12]);
	});
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { TrackingMarketsService } from "@/modules/tracking/markets.service";
import { RankCheckJobs } from "@/modules/tracking/rank-check.jobs";
import {
	configureRankLookup,
	describeStoreError,
	RANK_LOOKUP_MAX_ATTEMPTS,
	STORE_BREAKER_MAX_CONSECUTIVE_FAILURES,
	STORE_THROTTLE_MAX_EVENTS,
	STORE_THROTTLED_CODE,
} from "@/modules/tracking/rank-lookup";
import {
	SUMMARY_RETRY_COOLDOWN_MS,
	TrackingService,
} from "@/modules/tracking/tracking.service";
import { cleanupStores, getTestWorkspaceId } from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { db } from "@/utils/db";
import { rankCheckRuns, rankSnapshots } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

const COUNTRY = "us";
const KEYWORD_COUNT = 12;
const storeIds: string[] = [];
let storeId: string;

/** Virtual clock: sleeping advances time instantly. */
function fakeTime() {
	let now = 10_000_000;
	return {
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

async function appWithKeywords(n = KEYWORD_COUNT) {
	const app = await seedTestApp(storeId);
	await TrackingService.addKeywords(app.id, COUNTRY, keywordList(n));
	return app.id;
}

async function snapshotCount(appId: string) {
	const rows = await db
		.select({ id: rankSnapshots.id })
		.from(rankSnapshots)
		.where(eq(rankSnapshots.appId, appId));
	return rows.length;
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

describe("rank check circuit breaker", () => {
	it("stops after 8 keywords in a row fail and frees the app", async () => {
		const appId = await appWithKeywords();
		const time = fakeTime();
		let calls = 0;
		configureRankLookup({
			fetchPosition: async () => {
				calls++;
				throw storeError(503);
			},
			now: time.now,
			sleep: time.sleep,
		});

		await RankCheckJobs.start(appId, getTestWorkspaceId(), "manual");
		await RankCheckJobs.waitFor(appId);

		const run = await RankCheckJobs.latest(appId, getTestWorkspaceId());
		expect(run?.status).toBe("failed");
		expect(run?.error).toContain("Store throttled");
		expect(run?.error).toContain(
			`${STORE_BREAKER_MAX_CONSECUTIVE_FAILURES} lookups in a row failed`,
		);
		expect(run?.checked).toBe(STORE_BREAKER_MAX_CONSECUTIVE_FAILURES);
		expect(run?.failed).toBe(STORE_BREAKER_MAX_CONSECUTIVE_FAILURES);
		expect(run?.total).toBe(KEYWORD_COUNT);
		// The remaining keywords were never looked up.
		expect(calls).toBe(
			STORE_BREAKER_MAX_CONSECUTIVE_FAILURES * RANK_LOOKUP_MAX_ATTEMPTS,
		);
		expect(await snapshotCount(appId)).toBe(0);
		expect(RankCheckJobs.isRunning(appId)).toBe(false);
	});

	it("stops when the store has answered nothing for 30 minutes", async () => {
		const appId = await appWithKeywords();
		const time = fakeTime();
		configureRankLookup({
			// A store that hangs for 11 min per request and then errors.
			fetchPosition: async () => {
				await time.sleep(11 * 60_000);
				throw storeError(503);
			},
			now: time.now,
			sleep: time.sleep,
		});

		await RankCheckJobs.start(appId, getTestWorkspaceId(), "manual");
		await RankCheckJobs.waitFor(appId);

		const run = await RankCheckJobs.latest(appId, getTestWorkspaceId());
		expect(run?.status).toBe("failed");
		expect(run?.error).toContain("no answer from the store for 30 min");
		expect(run?.checked).toBeLessThan(3);
		expect(await snapshotCount(appId)).toBe(0);
	});

	it("stops cleanly after 3 throttle answers in 30 minutes", async () => {
		const appId = await appWithKeywords();
		const time = fakeTime();
		let calls = 0;
		configureRankLookup({
			fetchPosition: async () => {
				calls++;
				throw storeError(429);
			},
			now: time.now,
			sleep: time.sleep,
		});

		await RankCheckJobs.start(appId, getTestWorkspaceId(), "manual");
		await RankCheckJobs.waitFor(appId);

		const run = await RankCheckJobs.latest(appId, getTestWorkspaceId());
		expect(run?.status).toBe("failed");
		expect(run?.error).toContain(
			`${STORE_THROTTLE_MAX_EVENTS} throttle answers in 30 min`,
		);
		expect(run?.error).toContain("next scheduled check");
		// Three requests drew a throttle, the fourth was never sent.
		expect(calls).toBe(STORE_THROTTLE_MAX_EVENTS);
		// The blocked keyword is not a measurement: no snapshot, no "not ranked".
		expect(await snapshotCount(appId)).toBe(0);
		expect(RankCheckJobs.isRunning(appId)).toBe(false);
	});

	it("measures the least recently measured keywords first", async () => {
		const appId = await appWithKeywords(3);
		const looked: string[] = [];
		configureRankLookup({
			fetchPosition: async (_store, keyword) => {
				looked.push(keyword);
				return 4;
			},
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
		});
		// kw 00 measured recently, kw 01 long ago, kw 02 never.
		await db.insert(rankSnapshots).values([
			{
				appId,
				country: COUNTRY,
				createdAt: new Date(Date.now() - 60_000),
				keyword: "kw 00",
				platform: "android",
				position: 1,
			},
			{
				appId,
				country: COUNTRY,
				createdAt: new Date(Date.now() - 86_400_000),
				keyword: "kw 01",
				platform: "android",
				position: 2,
			},
		]);

		await RankCheckJobs.start(appId, getTestWorkspaceId(), "manual");
		await RankCheckJobs.waitFor(appId);

		expect(looked).toEqual(["kw 02", "kw 01", "kw 00"]);
	});

	it("queues two runs on the same store instead of interleaving them", async () => {
		const first = (await seedTestApp(storeId)).id;
		const second = (await seedTestApp(storeId)).id;
		await TrackingService.addKeywords(first, COUNTRY, ["a 1", "a 2", "a 3"]);
		await TrackingService.addKeywords(second, COUNTRY, ["b 1", "b 2", "b 3"]);
		const order: string[] = [];
		configureRankLookup({
			fetchPosition: async (_store, keyword) => {
				order.push(keyword.slice(0, 1));
				await new Promise((resolve) => setTimeout(resolve, 1));
				return 4;
			},
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
		});

		await RankCheckJobs.start(first, getTestWorkspaceId(), "manual");
		await RankCheckJobs.start(second, getTestWorkspaceId(), "manual");
		await Promise.all([
			RankCheckJobs.waitFor(first),
			RankCheckJobs.waitFor(second),
		]);

		expect(order).toHaveLength(6);
		// One app's lookups all come before the other's.
		expect(new Set(order.slice(0, 3)).size).toBe(1);
		expect(new Set(order.slice(3)).size).toBe(1);
		expect(order[0]).not.toBe(order[3]);
		const runs = await Promise.all([
			RankCheckJobs.latest(first, getTestWorkspaceId()),
			RankCheckJobs.latest(second, getTestWorkspaceId()),
		]);
		expect(runs.map((r) => r?.status)).toEqual(["completed", "completed"]);
	});

	it("ends a slow but healthy run at the run time limit, keeping what it measured", async () => {
		const appId = await appWithKeywords();
		const time = fakeTime();
		const runtime = configureRankLookup({
			fetchPosition: async () => 4,
			now: time.now,
			sleep: time.sleep,
		});

		let thrown: unknown = null;
		try {
			await TrackingService.runRankCheck(
				appId,
				getTestWorkspaceId(),
				"manual",
				{
					breakerLimits: {
						maxConsecutiveFailures: 8,
						maxRunMs: 10_000,
						maxStallMs: 60_000,
					},
					runtime,
				},
			);
		} catch (err) {
			thrown = err;
		}

		expect(describeStoreError(thrown).message).toContain(
			"Run time limit reached",
		);
		const code = (thrown as { response?: { data?: { code?: string } } })
			.response?.data?.code;
		expect(code).toBe(STORE_THROTTLED_CODE);
		// Play spacing 3 s: lookups at 0, 3, 6 and 9 s fit in 10 s.
		expect(await snapshotCount(appId)).toBe(4);
	});

	it("a success resets the failure streak, so scattered failures finish the run", async () => {
		const appId = await appWithKeywords();
		const time = fakeTime();
		const keywords = keywordList(KEYWORD_COUNT);
		configureRankLookup({
			fetchPosition: async (_store, keyword) => {
				if (keyword === keywords[7]) return 3;
				throw storeError(503);
			},
			now: time.now,
			sleep: time.sleep,
		});

		await RankCheckJobs.start(appId, getTestWorkspaceId(), "manual");
		await RankCheckJobs.waitFor(appId);

		const run = await RankCheckJobs.latest(appId, getTestWorkspaceId());
		expect(run?.status).toBe("completed");
		expect(run?.checked).toBe(KEYWORD_COUNT);
		expect(run?.failed).toBe(KEYWORD_COUNT - 1);
		expect(run?.measured).toBe(1);
	});
});

describe("dashboard summary retries a first check that measured nothing", () => {
	const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

	it("decides from status, measured and the cooldown", () => {
		const now = new Date();
		const run = (
			status: string,
			measured: number,
			finishedAt: Date | null,
			startedAt = at(120),
		) => ({ finishedAt, measured, startedAt, status });

		expect(TrackingService.shouldStartFirstCheck(null, now)).toBe(true);
		expect(
			TrackingService.shouldStartFirstCheck(run("running", 0, null), now),
		).toBe(false);
		expect(
			TrackingService.shouldStartFirstCheck(run("completed", 3, at(90)), now),
		).toBe(false);
		expect(
			TrackingService.shouldStartFirstCheck(run("failed", 0, at(5)), now),
		).toBe(false);
		expect(
			TrackingService.shouldStartFirstCheck(
				run("failed", 0, at(SUMMARY_RETRY_COOLDOWN_MS / 60_000 + 1)),
				now,
			),
		).toBe(true);
		// An interrupted row without finishedAt counts from its start.
		expect(
			TrackingService.shouldStartFirstCheck(
				run("interrupted", 0, null, at(45)),
				now,
			),
		).toBe(true);
	});

	async function seedEmptyRun(appId: string, minutesAgo: number) {
		const [row] = await db
			.insert(rankCheckRuns)
			.values({
				appId,
				checked: KEYWORD_COUNT,
				createdAt: at(minutesAgo + 1),
				error: "Store throttled: 8 lookups in a row failed",
				failed: KEYWORD_COUNT,
				finishedAt: at(minutesAgo),
				kind: "summary",
				measured: 0,
				startedAt: at(minutesAgo + 1),
				status: "failed",
				total: KEYWORD_COUNT,
				workspaceId: getTestWorkspaceId(),
			})
			.returning();
		return row.id;
	}

	it("starts a new check once the cooldown has passed", async () => {
		const appId = await appWithKeywords(3);
		const oldRunId = await seedEmptyRun(appId, 31);
		configureRankLookup({
			fetchPosition: async () => 6,
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
		});

		const summary = await TrackingService.getSummary(
			appId,
			getTestWorkspaceId(),
		);
		await RankCheckJobs.waitFor(appId);

		expect(summary.rankCheck?.id).not.toBe(oldRunId);
		expect(summary.rankCheck?.status).toBe("running");
		expect(await snapshotCount(appId)).toBe(3);
	});

	it("does not retry inside the cooldown", async () => {
		const appId = await appWithKeywords(3);
		const oldRunId = await seedEmptyRun(appId, 5);

		const summary = await TrackingService.getSummary(
			appId,
			getTestWorkspaceId(),
		);

		expect(summary.rankCheck?.id).toBe(oldRunId);
		expect(RankCheckJobs.isRunning(appId)).toBe(false);
	});
});

describe("latest measurements per tracked keyword", () => {
	it("reads the two newest snapshots per keyword, beyond the old 2,000-row window", async () => {
		const appId = (await seedTestApp(storeId)).id;
		await TrackingService.addKeywords(appId, COUNTRY, [
			"alpha",
			"beta",
			"gamma",
		]);
		const base = Date.now() - 10 * 24 * 60 * 60_000;
		const minute = (n: number) => new Date(base + n * 60_000);

		await db.insert(rankSnapshots).values([
			// beta: one old measurement, older than everything below.
			{
				appId,
				country: COUNTRY,
				createdAt: minute(0),
				keyword: "beta",
				platform: "playstore",
				position: 12,
			},
			// alpha: three measurements, newest last.
			{
				appId,
				country: COUNTRY,
				createdAt: minute(1),
				keyword: "alpha",
				platform: "playstore",
				position: 9,
			},
			{
				appId,
				country: COUNTRY,
				createdAt: minute(2),
				keyword: "alpha",
				platform: "playstore",
				position: 7,
			},
			{
				appId,
				country: COUNTRY,
				createdAt: minute(3),
				keyword: "alpha",
				platform: "playstore",
				position: 5,
			},
			// A keyword no longer tracked.
			{
				appId,
				country: COUNTRY,
				createdAt: minute(4),
				keyword: "ghost",
				platform: "playstore",
				position: 1,
			},
		]);
		// 2,100 newer measurements of gamma push beta out of any "newest
		// 2,000 rows of the app" window.
		await db.insert(rankSnapshots).values(
			Array.from({ length: 2_100 }, (_, i) => ({
				appId,
				country: COUNTRY,
				createdAt: minute(10 + i),
				keyword: "gamma",
				platform: "playstore",
				position: i === 2_099 ? 30 : 40,
			})),
		);

		const positions = await TrackingService.getLatestPositions(appId);
		expect(positions.map((p) => p.keyword)).toEqual(["alpha", "beta", "gamma"]);
		const byKeyword = new Map(positions.map((p) => [p.keyword, p]));
		expect(byKeyword.get("alpha")).toMatchObject({
			delta: 2,
			position: 5,
			previousPosition: 7,
		});
		expect(byKeyword.get("beta")).toMatchObject({
			delta: null,
			position: 12,
			previousPosition: null,
		});
		expect(byKeyword.get("gamma")).toMatchObject({
			delta: 10,
			position: 30,
			previousPosition: 40,
		});

		// The per-market overview reads the same rows, so the two agree.
		const markets = await TrackingMarketsService.getMarkets(
			appId,
			getTestWorkspaceId(),
		);
		const us = markets.markets.find((m) => m.country === COUNTRY);
		expect(us?.tracked).toBe(3);
		expect(us?.measured).toBe(3);
		expect(us?.ranked).toBe(3);
		expect(us?.bestPosition).toBe(5);
		expect(us?.improved).toBe(2);
	});
});

import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { ResearchService } from "@/modules/research/research.service";
import { storesController } from "@/modules/stores";
import { trackingController } from "@/modules/tracking";
import { RankCheckJobs } from "@/modules/tracking/rank-check.jobs";
import { configureRankLookup } from "@/modules/tracking/rank-lookup";
import { MAX_KEYWORDS_PER_COUNTRY } from "@/modules/tracking/tracking.types";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceIdB,
} from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { db } from "@/utils/db";
import { appAsoProfiles } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";

const BASE = "http://localhost/api";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) =>
		a.use(storesController).use(appsController).use(trackingController),
	);

let appId: string;
let appIdB: string;
const storeIds: string[] = [];

async function json(res: Response) {
	return (await res.json()) as Record<string, unknown>;
}

beforeAll(async () => {
	// No real spacing between store lookups under test.
	configureRankLookup({
		sleep: async () => {},
		spacingMs: { appstore: 0, playstore: 0 },
	});
	const store = await seedTestStore();
	storeIds.push(store.id);
	const seeded = await seedTestApp(store.id);
	appId = seeded.id;

	const storeB = await seedTestStore(getTestWorkspaceIdB());
	storeIds.push(storeB.id);
	const seededB = await seedTestApp(storeB.id);
	appIdB = seededB.id;
});

afterAll(async () => {
	configureRankLookup();
	await cleanupStores(storeIds);
});

describe("Tracking config", () => {
	it("returns a default (all-off) config for a fresh app", async () => {
		const res = await app.handle(authRequest(`${BASE}/apps/${appId}/tracking`));
		expect(res.status).toBe(200);
		const body = (await json(res)) as {
			config: { rankTrackingEnabled: boolean; autoResearchEnabled: boolean };
			keywords: unknown[];
			positions: unknown[];
		};
		expect(body.config.rankTrackingEnabled).toBe(false);
		expect(body.config.autoResearchEnabled).toBe(false);
		expect(body.keywords).toEqual([]);
		expect(body.positions).toEqual([]);
	});

	it("updates automation settings", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/config`, {
				body: JSON.stringify({
					autoResearchFrequency: "daily",
					rankTrackingEnabled: true,
				}),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);
		expect(res.status).toBe(200);
		const body = (await json(res)) as {
			config: { rankTrackingEnabled: boolean; autoResearchFrequency: string };
		};
		expect(body.config.rankTrackingEnabled).toBe(true);
		expect(body.config.autoResearchFrequency).toBe("daily");
	});
});

describe("Tracked keywords", () => {
	it("adds keywords for a country and dedupes case-insensitively", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/keywords`, {
				body: JSON.stringify({
					country: "us",
					keywords: ["Task Manager", "task manager", "todo"],
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		const body = (await json(res)) as {
			keywords: Array<{ keyword: string; country: string }>;
		};
		const usKeywords = body.keywords.filter((k) => k.country === "us");
		expect(usKeywords.map((k) => k.keyword).sort()).toEqual([
			"task manager",
			"todo",
		]);
	});

	it("enforces the per-language keyword cap", async () => {
		const atCap = Array.from(
			{ length: MAX_KEYWORDS_PER_COUNTRY },
			(_, i) => `kw-${i}`,
		);
		const ok = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/keywords`, {
				body: JSON.stringify({ country: "de", keywords: atCap }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(ok.status).toBe(200);

		const over = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/keywords`, {
				body: JSON.stringify({ country: "de", keywords: ["one-too-many"] }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(over.status).toBe(422);
	});

	it("removes a keyword", async () => {
		const list = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking`),
		);
		const body = (await json(list)) as {
			keywords: Array<{ id: string; keyword: string; country: string }>;
		};
		const target = body.keywords.find((k) => k.keyword === "todo");
		expect(target).toBeDefined();

		const res = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/keywords/${target?.id}`, {
				method: "DELETE",
			}),
		);
		expect(res.status).toBe(200);
		const del = (await json(res)) as { success: boolean };
		expect(del.success).toBe(true);
	});
});

describe("Starred keywords", () => {
	type TrackedRow = {
		country: string;
		id: string;
		keyword: string;
		starred: boolean;
	};

	async function trackedRows(id: string): Promise<TrackedRow[]> {
		const res = await app.handle(authRequest(`${BASE}/apps/${id}/tracking`));
		return ((await json(res)) as { keywords: TrackedRow[] }).keywords;
	}

	function patchJson(url: string, body: unknown, request = authRequest) {
		return app.handle(
			request(url, {
				body: JSON.stringify(body),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);
	}

	it("tracks new keywords unstarred", async () => {
		const rows = await trackedRows(appId);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((k) => k.starred === false)).toBe(true);
	});

	it("stars and unstars one keyword", async () => {
		const target = (await trackedRows(appId)).find(
			(k) => k.keyword === "task manager",
		);
		expect(target).toBeDefined();
		const url = `${BASE}/apps/${appId}/tracking/keywords/${target?.id}`;

		const on = await patchJson(url, { starred: true });
		expect(on.status).toBe(200);
		const body = (await json(on)) as { keyword: TrackedRow };
		expect(body.keyword).toEqual(
			expect.objectContaining({ id: target?.id, starred: true }),
		);
		const after = await trackedRows(appId);
		expect(after.filter((k) => k.starred).map((k) => k.keyword)).toEqual([
			"task manager",
		]);

		const off = await patchJson(url, { starred: false });
		expect(off.status).toBe(200);
		expect((await trackedRows(appId)).some((k) => k.starred)).toBe(false);
	});

	it("answers 404 for an unknown keyword and 422 for a malformed id", async () => {
		const missing = await patchJson(
			`${BASE}/apps/${appId}/tracking/keywords/00000000-0000-0000-0000-000000000000`,
			{ starred: true },
		);
		expect(missing.status).toBe(404);
		const malformed = await patchJson(
			`${BASE}/apps/${appId}/tracking/keywords/not-a-uuid`,
			{ starred: true },
		);
		expect(malformed.status).toBe(422);
	});

	it("stars in bulk by market and reports phrases that are not tracked", async () => {
		const res = await patchJson(`${BASE}/apps/${appId}/tracking/keywords`, {
			items: [
				{ country: "DE", keywords: ["KW-1", "kw-2", "never tracked"] },
				{ country: "us", keywords: ["kw-1"] },
			],
			starred: true,
		});
		expect(res.status).toBe(200);
		const body = (await json(res)) as {
			results: Array<{
				country: string;
				notTracked: string[];
				updated: string[];
			}>;
			totals: { notTracked: number; updated: number };
		};
		expect(body.totals).toEqual({ notTracked: 2, updated: 2 });
		expect(body.results).toEqual([
			{
				country: "de",
				notTracked: ["never tracked"],
				updated: ["kw-1", "kw-2"],
			},
			{ country: "us", notTracked: ["kw-1"], updated: [] },
		]);

		const rows = await trackedRows(appId);
		const starred = rows.filter((k) => k.starred);
		expect(starred.map((k) => `${k.country}|${k.keyword}`).sort()).toEqual([
			"de|kw-1",
			"de|kw-2",
		]);
		// Starring never tracks.
		expect(rows.some((k) => k.keyword === "never tracked")).toBe(false);
	});

	it("carries starred and the keyword id on the board and in markets", async () => {
		const board = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/board?country=de`),
		);
		expect(board.status).toBe(200);
		const b = (await json(board)) as {
			keywords: Array<{
				keyword: string;
				keywordId: string | null;
				starred: boolean;
			}>;
			stats: { starred: number };
		};
		expect(b.stats.starred).toBe(2);
		const kw1 = b.keywords.find((k) => k.keyword === "kw-1");
		expect(kw1?.starred).toBe(true);
		expect(kw1?.keywordId).toEqual(expect.any(String));
		expect(b.keywords.find((k) => k.keyword === "kw-3")?.starred).toBe(false);

		const markets = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/markets`),
		);
		expect(markets.status).toBe(200);
		const m = (await json(markets)) as {
			markets: Array<{
				country: string;
				starred: number;
				starredTop10: number;
			}>;
			totals: { starred: number };
		};
		expect(m.markets.find((x) => x.country === "de")).toEqual(
			expect.objectContaining({ starred: 2, starredTop10: 0 }),
		);
		expect(m.markets.find((x) => x.country === "us")?.starred).toBe(0);
		expect(m.totals.starred).toBe(2);
	});

	it("workspace B cannot star workspace A's keywords", async () => {
		const target = (await trackedRows(appId)).find(
			(k) => k.keyword === "task manager",
		);
		const one = await patchJson(
			`${BASE}/apps/${appId}/tracking/keywords/${target?.id}`,
			{ starred: true },
			authRequestB,
		);
		expect(one.status).toBe(404);
		const bulk = await patchJson(
			`${BASE}/apps/${appId}/tracking/keywords`,
			{ items: [{ country: "us", keywords: ["task manager"] }], starred: true },
			authRequestB,
		);
		expect(bulk.status).toBe(404);
		// A keyword id from app A cannot be starred through app B's URL.
		const crossApp = await patchJson(
			`${BASE}/apps/${appIdB}/tracking/keywords/${target?.id}`,
			{ starred: true },
			authRequestB,
		);
		expect(crossApp.status).toBe(404);
		expect(
			(await trackedRows(appId)).find((k) => k.keyword === "task manager")
				?.starred,
		).toBe(false);
	});
});

describe("Rank check", () => {
	it("records a snapshot per tracked keyword and updates history", async () => {
		const spy = spyOn(ResearchService, "positionFor").mockResolvedValue(7);
		try {
			const res = await app.handle(
				authRequest(`${BASE}/apps/${appId}/tracking/check`, {
					method: "POST",
				}),
			);
			// Runs in the background: the request returns the job at once.
			expect(res.status).toBe(202);
			const body = (await json(res)) as {
				alreadyRunning: boolean;
				run: { id: string; status: string; total: number };
			};
			expect(body.alreadyRunning).toBe(false);
			expect(body.run.status).toBe("running");
			expect(body.run.total).toBeGreaterThan(0);

			await RankCheckJobs.waitFor(appId);
			const status = await app.handle(
				authRequest(`${BASE}/apps/${appId}/tracking/check/${body.run.id}`),
			);
			expect(status.status).toBe(200);
			const done = (await json(status)) as {
				run: {
					checked: number;
					failed: number;
					measured: number;
					progress: number;
					status: string;
					total: number;
				};
			};
			expect(done.run.status).toBe("completed");
			expect(done.run.measured).toBe(done.run.total);
			expect(done.run.checked).toBe(done.run.total);
			expect(done.run.failed).toBe(0);
			expect(done.run.progress).toBe(1);
			expect(spy).toHaveBeenCalled();

			const history = await app.handle(
				authRequest(`${BASE}/apps/${appId}/tracking/history`),
			);
			const h = (await json(history)) as {
				snapshots: Array<{ position: number | null }>;
				annotations: unknown[];
			};
			expect(h.snapshots.length).toBeGreaterThan(0);
			expect(h.snapshots[0].position).toBe(7);
			expect(Array.isArray(h.annotations)).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});
});

describe("Tracking summary", () => {
	it("returns empty stats for an app without profile or keywords", async () => {
		const seeded = await seedTestApp(storeIds[0]);
		const res = await app.handle(
			authRequest(`${BASE}/apps/${seeded.id}/tracking/summary`),
		);
		expect(res.status).toBe(200);
		const body = (await json(res)) as {
			positions: unknown[];
			stats: { trackedKeywords: number; avgPosition: number | null };
		};
		expect(body.stats.trackedKeywords).toBe(0);
		expect(body.stats.avgPosition).toBeNull();
		expect(body.positions).toEqual([]);
	});

	it("imports ASO-profile keywords, runs a first check and aggregates stats", async () => {
		const seeded = await seedTestApp(storeIds[0]);
		await db.insert(appAsoProfiles).values({
			appId: seeded.id,
			longTailKeywords: ["habit streak app"],
			mustIncludeKeywords: ["Habit Tracker", "daily habits"],
		});

		const spy = spyOn(ResearchService, "positionFor").mockResolvedValue(5);
		try {
			// First call imports the keywords and starts the check in the
			// background instead of blocking the dashboard on store lookups.
			const first = await app.handle(
				authRequest(`${BASE}/apps/${seeded.id}/tracking/summary`),
			);
			expect(first.status).toBe(200);
			const started = (await json(first)) as {
				rankCheck: { status: string } | null;
				stats: { trackedKeywords: number };
			};
			expect(started.stats.trackedKeywords).toBe(3);
			expect(started.rankCheck?.status).toBe("running");
			await RankCheckJobs.waitFor(seeded.id);

			const res = await app.handle(
				authRequest(`${BASE}/apps/${seeded.id}/tracking/summary`),
			);
			expect(res.status).toBe(200);
			const body = (await json(res)) as {
				config: { rankTrackingEnabled: boolean };
				positions: Array<{ keyword: string; position: number | null }>;
				stats: {
					avgPosition: number | null;
					bestPosition: number | null;
					rankedKeywords: number;
					top10Count: number;
					trackedKeywords: number;
				};
			};
			expect(body.stats.trackedKeywords).toBe(3);
			expect(body.stats.rankedKeywords).toBe(3);
			expect(body.stats.avgPosition).toBe(5);
			expect(body.stats.bestPosition).toBe(5);
			expect(body.stats.top10Count).toBe(3);
			expect(body.config.rankTrackingEnabled).toBe(true);
			const kws = body.positions.map((p) => p.keyword).sort();
			expect(kws).toEqual([
				"daily habits",
				"habit streak app",
				"habit tracker",
			]);
			expect(spy).toHaveBeenCalledTimes(3);
		} finally {
			spy.mockRestore();
		}
	});

	it("does not re-run the check when positions already exist", async () => {
		const seeded = await seedTestApp(storeIds[0]);
		await db.insert(appAsoProfiles).values({
			appId: seeded.id,
			mustIncludeKeywords: ["workout log"],
		});

		const spy = spyOn(ResearchService, "positionFor").mockResolvedValue(9);
		try {
			await app.handle(
				authRequest(`${BASE}/apps/${seeded.id}/tracking/summary`),
			);
			await RankCheckJobs.waitFor(seeded.id);
			expect(spy).toHaveBeenCalledTimes(1);
			await app.handle(
				authRequest(`${BASE}/apps/${seeded.id}/tracking/summary`),
			);
			await RankCheckJobs.waitFor(seeded.id);
			expect(spy).toHaveBeenCalledTimes(1);
		} finally {
			spy.mockRestore();
		}
	});
});

describe("Workspace isolation", () => {
	it("workspace B cannot read workspace A's tracking", async () => {
		const res = await app.handle(
			authRequestB(`${BASE}/apps/${appId}/tracking`),
		);
		expect(res.status).toBe(404);
	});

	it("workspace B cannot read workspace A's tracking summary", async () => {
		const res = await app.handle(
			authRequestB(`${BASE}/apps/${appId}/tracking/summary`),
		);
		expect(res.status).toBe(404);
	});

	it("workspace A cannot read workspace B's tracking", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/apps/${appIdB}/tracking`),
		);
		expect(res.status).toBe(404);
	});
});

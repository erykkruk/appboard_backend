import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { ResearchService } from "@/modules/research/research.service";
import { storesController } from "@/modules/stores";
import { trackingController } from "@/modules/tracking";
import { RankCheckJobs } from "@/modules/tracking/rank-check.jobs";
import { configureRankLookup } from "@/modules/tracking/rank-lookup";
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

	it("enforces the 20-keyword-per-language cap", async () => {
		const twenty = Array.from({ length: 20 }, (_, i) => `kw-${i}`);
		const ok = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/keywords`, {
				body: JSON.stringify({ country: "de", keywords: twenty }),
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

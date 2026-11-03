import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { ResearchService } from "@/modules/research/research.service";
import { StoresService } from "@/modules/stores/stores.service";
import { trackingController } from "@/modules/tracking";
import { RankCheckJobs } from "@/modules/tracking/rank-check.jobs";
import {
	configureRankLookup,
	RANK_LOOKUP_MAX_ATTEMPTS,
} from "@/modules/tracking/rank-lookup";
import { MAX_KEYWORDS_PER_COUNTRY } from "@/modules/tracking/tracking.types";
import { devicesFromAscPlatforms } from "@/providers/app-store";
import { GooglePlayProvider } from "@/providers/google-play";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
	getTestWorkspaceIdB,
} from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { db } from "@/utils/db";
import { apps, rankCheckRuns, rankSnapshots } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { errorHandler } from "@/utils/errors/errorHandler";

const BASE = "http://localhost/api";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(appsController).use(trackingController));

const storeIds: string[] = [];
let appId: string;
let appIdB: string;

type Json = Record<string, unknown>;

function post(path: string, body?: unknown, b = false) {
	const make = b ? authRequestB : authRequest;
	return app.handle(
		make(`${BASE}${path}`, {
			...(body === undefined
				? {}
				: {
						body: JSON.stringify(body),
						headers: { "Content-Type": "application/json" },
					}),
			method: "POST",
		}),
	);
}

function get(path: string, b = false) {
	return app.handle((b ? authRequestB : authRequest)(`${BASE}${path}`));
}

function patch(path: string, body: unknown, b = false) {
	return app.handle(
		(b ? authRequestB : authRequest)(`${BASE}${path}`, {
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
			method: "PATCH",
		}),
	);
}

function throttled(status: number): unknown {
	try {
		buildError("storeApiError", {
			info: `iTunes search HTTP ${status}`,
			status,
		});
	} catch (err) {
		return err;
	}
	return null;
}

async function seedApp(
	storeId: string,
	values: Partial<typeof apps.$inferInsert> = {},
) {
	const seeded = await seedTestApp(storeId);
	if (Object.keys(values).length) {
		await db.update(apps).set(values).where(eq(apps.id, seeded.id));
	}
	return seeded;
}

beforeAll(async () => {
	configureRankLookup({
		sleep: async () => {},
		spacingMs: { appstore: 0, playstore: 0 },
	});
	const store = await seedTestStore();
	storeIds.push(store.id);
	appId = (await seedApp(store.id)).id;

	const storeB = await seedTestStore(getTestWorkspaceIdB());
	storeIds.push(storeB.id);
	appIdB = (await seedApp(storeB.id)).id;
});

afterAll(async () => {
	configureRankLookup();
	await cleanupStores(storeIds);
});

describe("POST /apps/:appId/tracking/keywords/bulk", () => {
	it("adds many markets in one call, merging repeated countries", async () => {
		const res = await post(`/apps/${appId}/tracking/keywords/bulk`, {
			items: [
				{ country: "us", keywords: ["Party Game", "trivia", "quiz night"] },
				{ country: "pl", keywords: ["gra imprezowa", "quiz"] },
				{ country: "US", keywords: ["party game", "game show"] },
			],
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			keywords: Array<{ country: string; keyword: string }>;
			results: Array<{
				added: string[];
				country: string;
				rejected: string[];
				skipped: string[];
			}>;
			totals: { added: number; rejected: number; skipped: number };
		};
		expect(body.results.map((r) => r.country)).toEqual(["pl", "us"]);
		const us = body.results.find((r) => r.country === "us");
		expect(us?.added.sort()).toEqual([
			"game show",
			"party game",
			"quiz night",
			"trivia",
		]);
		expect(body.totals).toEqual({ added: 6, rejected: 0, skipped: 0 });
		expect(body.keywords.length).toBe(6);
	});

	it("reports already-tracked and over-the-cap keywords per market", async () => {
		const many = Array.from(
			{ length: MAX_KEYWORDS_PER_COUNTRY + 5 },
			(_, i) => `spiel ${i}`,
		);
		const res = await post(`/apps/${appId}/tracking/keywords/bulk`, {
			items: [
				{ country: "de", keywords: many },
				{ country: "us", keywords: ["trivia", "family games"] },
			],
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			results: Array<{
				added: string[];
				country: string;
				rejected: string[];
				skipped: string[];
			}>;
		};
		const de = body.results.find((r) => r.country === "de");
		expect(de?.added.length).toBe(MAX_KEYWORDS_PER_COUNTRY);
		expect(de?.rejected.length).toBe(5);
		const us = body.results.find((r) => r.country === "us");
		expect(us?.added).toEqual(["family games"]);
		expect(us?.skipped).toEqual(["trivia"]);
	});

	it("validates the body", async () => {
		const badCountry = await post(`/apps/${appId}/tracking/keywords/bulk`, {
			items: [{ country: "usa", keywords: ["x"] }],
		});
		expect(badCountry.status).toBe(422);
		const empty = await post(`/apps/${appId}/tracking/keywords/bulk`, {
			items: [],
		});
		expect(empty.status).toBe(422);
	});

	it("workspace B cannot add keywords to workspace A's app", async () => {
		const res = await post(
			`/apps/${appId}/tracking/keywords/bulk`,
			{ items: [{ country: "us", keywords: ["x"] }] },
			true,
		);
		expect(res.status).toBe(404);
	});
});

describe("Rank check job + failed lookups", () => {
	it("does not store a failed lookup as 'not ranked' and records it on the run", async () => {
		const positions: Record<string, number | null> = {
			"family games": null,
			"game show": 7,
			"party game": 3,
			"quiz night": 15,
		};
		const spy = spyOn(ResearchService, "positionFor").mockImplementation(
			async (_store, keyword, _id, country) => {
				if (country !== "us") return 30;
				if (keyword === "trivia") throw throttled(403);
				return positions[keyword] ?? null;
			},
		);
		try {
			const res = await post(`/apps/${appId}/tracking/check`);
			expect(res.status).toBe(202);
			const { run } = (await res.json()) as { run: { id: string } };
			await RankCheckJobs.waitFor(appId);

			const statusRes = await get(`/apps/${appId}/tracking/check/${run.id}`);
			const { run: done } = (await statusRes.json()) as {
				run: {
					failed: number;
					failures: Array<{
						attempts: number;
						country: string;
						keyword: string;
						status: number | null;
					}>;
					measured: number;
					status: string;
					total: number;
				};
			};
			expect(done.status).toBe("completed");
			expect(done.failed).toBe(1);
			expect(done.measured).toBe(done.total - 1);
			expect(done.failures).toEqual([
				expect.objectContaining({
					attempts: RANK_LOOKUP_MAX_ATTEMPTS,
					country: "us",
					keyword: "trivia",
					status: 403,
				}),
			]);

			const triviaRows = await db
				.select()
				.from(rankSnapshots)
				.where(
					and(
						eq(rankSnapshots.appId, appId),
						eq(rankSnapshots.keyword, "trivia"),
					),
				);
			expect(triviaRows).toEqual([]);
		} finally {
			spy.mockRestore();
		}
	});

	it("GET /tracking/check returns the latest run", async () => {
		const res = await get(`/apps/${appId}/tracking/check`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { run: { status: string } | null };
		expect(body.run?.status).toBe("completed");
	});

	it("returns the running job instead of starting a second one", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const spy = spyOn(ResearchService, "positionFor").mockImplementation(
			async () => {
				await gate;
				return 5;
			},
		);
		try {
			const first = await post(`/apps/${appId}/tracking/check`);
			const second = await post(`/apps/${appId}/tracking/check`);
			expect(first.status).toBe(202);
			expect(second.status).toBe(202);
			const a = (await first.json()) as {
				alreadyRunning: boolean;
				run: { id: string };
			};
			const b = (await second.json()) as {
				alreadyRunning: boolean;
				run: { id: string; status: string };
			};
			expect(a.alreadyRunning).toBe(false);
			expect(b.alreadyRunning).toBe(true);
			expect(b.run.id).toBe(a.run.id);
			expect(b.run.status).toBe("running");
			expect(RankCheckJobs.isRunning(appId)).toBe(true);
		} finally {
			release();
			await RankCheckJobs.waitFor(appId);
			spy.mockRestore();
		}
		expect(RankCheckJobs.isRunning(appId)).toBe(false);
	});

	it("marks a run orphaned by a restart as interrupted", async () => {
		const seeded = await seedApp(storeIds[0]);
		await db.insert(rankCheckRuns).values({
			appId: seeded.id,
			status: "running",
			total: 3,
			workspaceId: getTestWorkspaceId(),
		});
		const res = await get(`/apps/${seeded.id}/tracking/check`);
		const body = (await res.json()) as { run: { status: string } };
		expect(body.run.status).toBe("interrupted");
	});

	it("workspace B cannot start or read workspace A's checks", async () => {
		expect(
			(await post(`/apps/${appId}/tracking/check`, undefined, true)).status,
		).toBe(404);
		expect((await get(`/apps/${appId}/tracking/check`, true)).status).toBe(404);
		const latest = (await (
			await get(`/apps/${appId}/tracking/check`)
		).json()) as {
			run: { id: string };
		};
		expect(
			(await get(`/apps/${appId}/tracking/check/${latest.run.id}`, true))
				.status,
		).toBe(404);
		// A run id from another app is not served under this app either.
		expect(
			(await get(`/apps/${appIdB}/tracking/check/${latest.run.id}`, true))
				.status,
		).toBe(404);
	});
});

describe("GET /apps/:appId/tracking/markets", () => {
	it("aggregates every market and compares with the previous measurement", async () => {
		const app2 = await seedApp(storeIds[0]);
		await post(`/apps/${app2.id}/tracking/keywords/bulk`, {
			items: [
				{ country: "us", keywords: ["a", "b", "c", "d", "e"] },
				{ country: "gb", keywords: ["a"] },
			],
		});
		const earlier = new Date(Date.now() - 12 * 60 * 60 * 1000);
		const now = new Date();
		const snap = (
			country: string,
			keyword: string,
			position: number | null,
			createdAt: Date,
		) => ({
			appId: app2.id,
			country,
			createdAt,
			keyword,
			platform: "playstore",
			position,
		});
		await db.insert(rankSnapshots).values([
			// a: 8 -> 2 improved, b: 4 -> 9 declined, c: null -> 30 entered,
			// d: 12 -> null dropped, e: never measured.
			snap("us", "a", 8, earlier),
			snap("us", "a", 2, now),
			snap("us", "b", 4, earlier),
			snap("us", "b", 9, now),
			snap("us", "c", null, earlier),
			snap("us", "c", 30, now),
			snap("us", "d", 12, earlier),
			snap("us", "d", null, now),
			snap("gb", "a", 1, now),
			// An old measurement of an untracked keyword stays out of the totals.
			snap("us", "zzz", 1, now),
		]);

		const res = await get(`/apps/${app2.id}/tracking/markets`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			markets: Array<Json & { country: string }>;
			rankTracking: { supported: boolean; surface: string };
			totals: Json;
		};
		expect(body.rankTracking).toMatchObject({
			supported: true,
			surface: "play-search",
		});
		expect(body.markets.map((m) => m.country)).toEqual(["gb", "us"]);
		const us = body.markets.find((m) => m.country === "us");
		expect(us).toMatchObject({
			avgPosition: 13.7,
			bestPosition: 2,
			declined: 1,
			dropped: 1,
			entered: 1,
			failedLastRun: 0,
			improved: 1,
			measured: 4,
			medianPosition: 9,
			ranked: 3,
			top10: 2,
			top50: 3,
			tracked: 5,
		});
		expect(us?.lastCheckedAt).not.toBeNull();
		expect(body.totals).toMatchObject({
			markets: 2,
			measured: 5,
			ranked: 4,
			top10: 3,
			tracked: 6,
		});
	});

	it("counts earned rankings without the app's own name", async () => {
		const app3 = await seedApp(storeIds[0], { name: "Buzzin: TV Party" });
		await post(`/apps/${app3.id}/tracking/keywords/bulk`, {
			items: [
				{ country: "pl", keywords: ["buzzin", "buzzin tv", "trivia", "quiz"] },
				{ country: "cn", keywords: ["buzzin", "trivia"] },
			],
		});
		const earlier = new Date(Date.now() - 12 * 60 * 60 * 1000);
		const now = new Date();
		const snap = (
			country: string,
			keyword: string,
			position: number | null,
			createdAt: Date,
		) => ({
			appId: app3.id,
			country,
			createdAt,
			keyword,
			platform: "playstore",
			position,
		});
		await db
			.insert(rankSnapshots)
			.values([
				snap("pl", "buzzin", 1, now),
				snap("pl", "buzzin tv", 2, now),
				snap("pl", "trivia", 15, earlier),
				snap("pl", "trivia", 12, now),
				snap("pl", "quiz", 40, now),
				snap("cn", "buzzin", 3, now),
				snap("cn", "trivia", null, now),
			]);

		const res = await get(`/apps/${app3.id}/tracking/markets`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			markets: Array<Json & { country: string }>;
		};
		const pl = body.markets.find((m) => m.country === "pl");
		expect(pl).toMatchObject({
			bestEarned: { delta: 3, keyword: "trivia", position: 12 },
			earnedRanked: 2,
			earnedTop10: 0,
			earnedTop50: 2,
			ranked: 4,
			top10: 2,
		});
		const cn = body.markets.find((m) => m.country === "cn");
		expect(cn).toMatchObject({
			bestEarned: null,
			earnedRanked: 0,
			earnedTop10: 0,
			ranked: 1,
			top10: 1,
		});
	});

	it("flags a tvOS-only App Store record as not rank-trackable", async () => {
		const tv = await seedApp(storeIds[0], {
			devices: ["tv"],
			externalId: "6787068440",
			platform: "ios",
		});
		await post(`/apps/${tv.id}/tracking/keywords/bulk`, {
			items: [{ country: "us", keywords: ["party game"] }],
		});

		const markets = await get(`/apps/${tv.id}/tracking/markets`);
		const body = (await markets.json()) as {
			app: { devices: string[] };
			rankTracking: { note: string; supported: boolean };
		};
		expect(body.app.devices).toEqual(["tv"]);
		expect(body.rankTracking.supported).toBe(false);
		expect(body.rankTracking.note).toContain("tvOS");

		const check = await post(`/apps/${tv.id}/tracking/check`);
		expect(check.status).toBe(422);
		const error = (await check.json()) as { data?: { code?: string } };
		expect(error.data?.code).toBe("RANK_TRACKING_UNSUPPORTED");
		expect(RankCheckJobs.isRunning(tv.id)).toBe(false);
	});

	it("workspace B cannot read workspace A's markets", async () => {
		expect((await get(`/apps/${appId}/tracking/markets`, true)).status).toBe(
			404,
		);
	});
});

describe("PATCH /apps/:appId (devices)", () => {
	it("stores devices in a stable order", async () => {
		const res = await patch(`/apps/${appId}`, { devices: ["tv", "phone"] });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { app: { devices: string[] } };
		expect(body.app.devices).toEqual(["phone", "tv"]);

		const read = await get(`/apps/${appId}`);
		const readBody = (await read.json()) as { app: { devices: string[] } };
		expect(readBody.app.devices).toEqual(["phone", "tv"]);
	});

	it("rejects an empty list and unknown devices", async () => {
		expect((await patch(`/apps/${appId}`, { devices: [] })).status).toBe(422);
		expect((await patch(`/apps/${appId}`, { devices: ["watch"] })).status).toBe(
			422,
		);
	});

	it("workspace B cannot change workspace A's app", async () => {
		expect(
			(await patch(`/apps/${appId}`, { devices: ["tv"] }, true)).status,
		).toBe(404);
	});

	it("store sync adds detected devices without dropping the user's", async () => {
		const externalId = `com.example.devices${Date.now()}`;
		const [row] = await db
			.insert(apps)
			.values({
				bundleId: externalId,
				devices: ["tv"],
				externalId,
				name: "TV build",
				platform: "android",
				storeId: storeIds[0],
			})
			.returning();
		const spy = spyOn(
			GooglePlayProvider.prototype,
			"fetchApps",
		).mockResolvedValue([
			{
				bundleId: externalId,
				devices: ["phone"],
				externalId,
				name: "TV build",
				platform: "android",
			},
		]);
		try {
			await StoresService.syncApps(storeIds[0]);
		} finally {
			spy.mockRestore();
		}
		const [synced] = await db
			.select({ devices: apps.devices })
			.from(apps)
			.where(eq(apps.id, row.id));
		expect(synced.devices).toEqual(["phone", "tv"]);
	});
});

describe("devicesFromAscPlatforms", () => {
	it("maps App Store version platforms to devices", () => {
		expect(devicesFromAscPlatforms(["TV_OS", "IOS", "IOS"])).toEqual([
			"phone",
			"tv",
		]);
		expect(devicesFromAscPlatforms(["MAC_OS"])).toEqual([]);
	});
});

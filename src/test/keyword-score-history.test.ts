import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { researchController } from "@/modules/research";
import { extractSsrAppIds } from "@/modules/research/appstore.client";
import { KeywordScoresHistoryService } from "@/modules/research/keyword-scores-history.service";
import type { KeywordScore } from "@/modules/research/research.types";
import { isScoreRefreshDue } from "@/modules/tracking/scheduler.service";
import { errorHandler } from "@/utils/errors/errorHandler";
import {
	authGuard,
	authRequest,
	authRequestB,
	getTestWorkspaceId,
	getTestWorkspaceIdB,
} from "./setup";

const TEST_WORKSPACE_ID = getTestWorkspaceId();
const TEST_WORKSPACE_ID_B = getTestWorkspaceIdB();

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(researchController));

function score(keyword: string, country = "us"): KeywordScore {
	return {
		appRank: 7,
		breakdown: {
			avgReviews: 100,
			brandName: null,
			dominantPlayers: 10,
			isBrandKeyword: false,
			marketAge: 10,
			medianReviews: 100,
			overrideReason: null,
			publisherDiversity: 10,
			ratingQuality: 10,
			ratingVolume: 10,
			rawTotal: 30,
			reviewVelocity: 10,
			titleMatchCount: 2,
			titleRelevance: 10,
		},
		classification: "moderate",
		competitors: [],
		country,
		difficulty: 30,
		difficultyLabel: "easy",
		downloads: {
			dailySearches: 100,
			positions: [{ high: 6, low: 1.5, position: 1, ttr: 30 }],
			tiers: {
				top5: { high: 3, low: 0.7 },
				top6to10: { high: 0.5, low: 0.1 },
				top11to20: { high: 0.1, low: 0 },
			},
		},
		keyword,
		opportunity: 42,
		popularity: 55,
		tiers: {
			top5: tier(),
			top10: tier(),
			top20: tier(),
		},
	};
}

function tier() {
	return {
		freshCount: 0,
		label: "easy",
		medianReviews: 100,
		minReviews: 10,
		tierScore: 30,
		titleKeywordCount: 1,
		totalApps: 5,
		weakCount: 1,
		weakestApp: "Some App",
	};
}

async function clearAll() {
	const entries = await KeywordScoresHistoryService.list(TEST_WORKSPACE_ID);
	for (const entry of entries) {
		await KeywordScoresHistoryService.delete(TEST_WORKSPACE_ID, entry.id);
	}
	const entriesB = await KeywordScoresHistoryService.list(TEST_WORKSPACE_ID_B);
	for (const entry of entriesB) {
		await KeywordScoresHistoryService.delete(TEST_WORKSPACE_ID_B, entry.id);
	}
}

beforeEach(clearAll);
afterEach(clearAll);

describe("KeywordScoresHistoryService", () => {
	it("upserts one row per keyword+country+day", async () => {
		await KeywordScoresHistoryService.upsertToday(TEST_WORKSPACE_ID, [
			score("fitness"),
		]);
		await KeywordScoresHistoryService.upsertToday(TEST_WORKSPACE_ID, [
			{ ...score("fitness"), difficulty: 50, opportunity: 10 },
		]);
		const entries = await KeywordScoresHistoryService.list(TEST_WORKSPACE_ID);
		expect(entries).toHaveLength(1);
		expect(entries[0].difficulty).toBe(50);
		expect(entries[0].opportunity).toBe(10);
	});

	it("skips failed scores", async () => {
		await KeywordScoresHistoryService.upsertToday(TEST_WORKSPACE_ID, [
			{ ...score("broken"), error: "iTunes down" },
		]);
		const entries = await KeywordScoresHistoryService.list(TEST_WORKSPACE_ID);
		expect(entries).toHaveLength(0);
	});

	it("filters by keyword and country", async () => {
		await KeywordScoresHistoryService.upsertToday(TEST_WORKSPACE_ID, [
			score("fitness", "us"),
			score("fitness", "pl"),
			score("yoga", "us"),
		]);
		const filtered = await KeywordScoresHistoryService.list(TEST_WORKSPACE_ID, {
			keyword: "fitness",
		});
		expect(filtered).toHaveLength(2);
		const plOnly = await KeywordScoresHistoryService.list(TEST_WORKSPACE_ID, {
			country: "pl",
		});
		expect(plOnly).toHaveLength(1);
		expect(plOnly[0].keyword).toBe("fitness");
	});

	it("returns trend points with today's snapshot", async () => {
		await KeywordScoresHistoryService.upsertToday(TEST_WORKSPACE_ID, [
			score("fitness"),
		]);
		const points = await KeywordScoresHistoryService.trend(
			TEST_WORKSPACE_ID,
			"fitness",
			"us",
		);
		expect(points).toHaveLength(1);
		expect(points[0].popularity).toBe(55);
		expect(points[0].appRank).toBe(7);
	});

	it("get returns the full payload and delete removes the row", async () => {
		await KeywordScoresHistoryService.upsertToday(TEST_WORKSPACE_ID, [
			score("fitness"),
		]);
		const [entry] = await KeywordScoresHistoryService.list(TEST_WORKSPACE_ID);
		const full = await KeywordScoresHistoryService.get(
			TEST_WORKSPACE_ID,
			entry.id,
		);
		expect(full.payload.tiers.top5.totalApps).toBe(5);
		await KeywordScoresHistoryService.delete(TEST_WORKSPACE_ID, entry.id);
		const after = await KeywordScoresHistoryService.list(TEST_WORKSPACE_ID);
		expect(after).toHaveLength(0);
	});

	it("cleanup drops rows older than retention only", async () => {
		await KeywordScoresHistoryService.upsertToday(TEST_WORKSPACE_ID, [
			score("fitness"),
		]);
		const removed = await KeywordScoresHistoryService.cleanup(90);
		expect(removed).toBe(0);
		const entries = await KeywordScoresHistoryService.list(TEST_WORKSPACE_ID);
		expect(entries).toHaveLength(1);
	});
});

describe("keyword score history endpoints", () => {
	it("workspace B cannot see or delete workspace A snapshots", async () => {
		await KeywordScoresHistoryService.upsertToday(TEST_WORKSPACE_ID, [
			score("fitness"),
		]);
		const [entry] = await KeywordScoresHistoryService.list(TEST_WORKSPACE_ID);

		const listB = await app.handle(
			authRequestB("http://localhost/api/research/keyword-scores/history"),
		);
		expect(listB.status).toBe(200);
		const bodyB = (await listB.json()) as { entries: unknown[] };
		expect(bodyB.entries).toHaveLength(0);

		const getB = await app.handle(
			authRequestB(
				`http://localhost/api/research/keyword-scores/history/${entry.id}`,
			),
		);
		expect(getB.status).toBe(404);

		const deleteB = await app.handle(
			authRequestB(
				`http://localhost/api/research/keyword-scores/history/${entry.id}`,
				{ method: "DELETE" },
			),
		);
		expect(deleteB.status).toBe(404);
	});

	it("lists, fetches and deletes through the API", async () => {
		await KeywordScoresHistoryService.upsertToday(TEST_WORKSPACE_ID, [
			score("fitness"),
		]);
		const list = await app.handle(
			authRequest("http://localhost/api/research/keyword-scores/history"),
		);
		expect(list.status).toBe(200);
		const body = (await list.json()) as {
			entries: Array<{ id: string; keyword: string }>;
		};
		expect(body.entries).toHaveLength(1);
		expect(body.entries[0].keyword).toBe("fitness");

		const trend = await app.handle(
			authRequest(
				"http://localhost/api/research/keyword-scores/trend?keyword=fitness&country=us",
			),
		);
		expect(trend.status).toBe(200);
		const trendBody = (await trend.json()) as { points: unknown[] };
		expect(trendBody.points).toHaveLength(1);

		const del = await app.handle(
			authRequest(
				`http://localhost/api/research/keyword-scores/history/${body.entries[0].id}`,
				{ method: "DELETE" },
			),
		);
		expect(del.status).toBe(200);
	});
});

describe("isScoreRefreshDue", () => {
	const at = (iso: string) => new Date(iso);
	it("fires only at the refresh hour", () => {
		expect(
			isScoreRefreshDue(
				{ lastScoreRefreshAt: null },
				at("2026-08-31T01:00:00+02:00"),
				"Europe/Warsaw",
			),
		).toBe(true);
		expect(
			isScoreRefreshDue(
				{ lastScoreRefreshAt: null },
				at("2026-08-31T02:00:00+02:00"),
				"Europe/Warsaw",
			),
		).toBe(false);
	});

	it("respects the minimum gap", () => {
		const now = at("2026-08-31T01:00:00+02:00");
		expect(
			isScoreRefreshDue(
				{ lastScoreRefreshAt: at("2026-08-31T00:30:00+02:00") },
				now,
				"Europe/Warsaw",
			),
		).toBe(false);
		expect(
			isScoreRefreshDue(
				{ lastScoreRefreshAt: at("2026-08-30T01:00:00+02:00") },
				now,
				"Europe/Warsaw",
			),
		).toBe(true);
	});
});

describe("extractSsrAppIds", () => {
	it("merges shelf lockups with nextPage apps in order, deduped", () => {
		const ids = extractSsrAppIds({
			data: [
				{
					data: {
						nextPage: {
							results: [
								{ id: 333, type: "apps" },
								{ id: 444, type: "editorial" },
								{ id: 111, type: "apps" },
								{ id: 555, type: "apps" },
							],
						},
						shelves: [
							{
								items: [
									{ lockup: { adamId: 111 } },
									{ lockup: { adamId: "222" } },
								],
							},
						],
					},
				},
			],
		});
		expect(ids).toEqual(["111", "222", "333", "555"]);
	});

	it("returns empty for malformed data", () => {
		expect(extractSsrAppIds({})).toEqual([]);
		expect(extractSsrAppIds({ data: [] })).toEqual([]);
	});
});

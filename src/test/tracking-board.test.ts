import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { auditController } from "@/modules/audit";
import type { KeywordScore } from "@/modules/research/scoring-types";
import { trackingController } from "@/modules/tracking";
import { AppEventsService } from "@/modules/tracking/app-events.service";
import type { TrackingBoard } from "@/modules/tracking/board.types";
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
import {
	keywordScoreSnapshots,
	listings,
	rankSnapshots,
	trackedKeywords,
} from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";

const BASE = "http://localhost/api";
const COUNTRY = "pl";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(trackingController).use(auditController));

let appId: string;
let appIdB: string;
const storeIds: string[] = [];

/** Days ago as a Date, at noon UTC so a day never straddles a boundary. */
function daysAgo(days: number): Date {
	const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	d.setUTCHours(12, 0, 0, 0);
	return d;
}

function dayOf(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function scorePayload(keyword: string, difficulty: number): KeywordScore {
	return {
		breakdown: {
			avgReviews: 100,
			brandName: null,
			dominantPlayers: 1,
			isBrandKeyword: false,
			marketAge: 1,
			medianReviews: 50,
			overrideReason: null,
			publisherDiversity: 1,
			ratingQuality: 1,
			ratingVolume: 1,
			rawTotal: difficulty,
			reviewVelocity: 1,
			titleMatchCount: 1,
			titleRelevance: 1,
		},
		classification: "sweet-spot",
		competitors: [
			{
				developer: "Rival Studio",
				rating: 4.5,
				ratingsCount: 12000,
				title: "Rival App",
				trackId: "999",
			},
		],
		country: COUNTRY,
		difficulty,
		difficultyLabel: difficulty < 40 ? "easy" : "medium",
		downloads: {
			dailySearches: 100,
			positions: [],
			tiers: {
				top5: { high: 20, low: 5 },
				top6to10: { high: 8, low: 2 },
				top11to20: { high: 3, low: 1 },
			},
		},
		keyword,
		opportunity: 70,
		popularity: 55,
		tiers: {
			top5: {
				freshCount: 0,
				label: "hard",
				medianReviews: 900,
				minReviews: 400,
				tierScore: 60,
				titleKeywordCount: 3,
				totalApps: 25,
				weakCount: 0,
				weakestApp: null,
			},
			top10: {
				freshCount: 1,
				label: "reachable",
				medianReviews: 50,
				minReviews: 10,
				tierScore: 30,
				titleKeywordCount: 2,
				totalApps: 25,
				weakCount: 3,
				weakestApp: "Small App",
			},
			top20: {
				freshCount: 1,
				label: "reachable",
				medianReviews: 40,
				minReviews: 5,
				tierScore: 20,
				titleKeywordCount: 2,
				totalApps: 25,
				weakCount: 5,
				weakestApp: "Small App",
			},
		},
	};
}

beforeAll(async () => {
	const store = await seedTestStore();
	storeIds.push(store.id);
	appId = (await seedTestApp(store.id)).id;

	const storeB = await seedTestStore(getTestWorkspaceIdB());
	storeIds.push(storeB.id);
	appIdB = (await seedTestApp(storeB.id)).id;

	// Three tracked terms with deliberately different stories:
	// "quiz na tv" climbs, "kalambury" falls out of the scan, "domowka" enters.
	await db.insert(trackedKeywords).values([
		{ appId, country: COUNTRY, keyword: "quiz na tv" },
		{ appId, country: COUNTRY, keyword: "kalambury" },
		{ appId, country: COUNTRY, keyword: "domowka" },
	]);

	const older = daysAgo(2);
	const newer = daysAgo(1);
	await db.insert(rankSnapshots).values([
		{
			appId,
			country: COUNTRY,
			createdAt: older,
			keyword: "quiz na tv",
			platform: "appstore",
			position: 12,
		},
		{
			appId,
			country: COUNTRY,
			createdAt: older,
			keyword: "kalambury",
			platform: "appstore",
			position: 44,
		},
		{
			appId,
			country: COUNTRY,
			createdAt: older,
			keyword: "domowka",
			platform: "appstore",
			position: null,
		},
		{
			appId,
			country: COUNTRY,
			createdAt: newer,
			keyword: "quiz na tv",
			platform: "appstore",
			position: 3,
		},
		{
			appId,
			country: COUNTRY,
			createdAt: newer,
			keyword: "kalambury",
			platform: "appstore",
			position: null,
		},
		{
			appId,
			country: COUNTRY,
			createdAt: newer,
			keyword: "domowka",
			platform: "appstore",
			position: 9,
		},
	]);

	await db.insert(keywordScoreSnapshots).values([
		{
			appRank: 12,
			classification: "sweet-spot",
			country: COUNTRY,
			day: dayOf(older),
			difficulty: 40,
			keyword: "quiz na tv",
			opportunity: 60,
			payload: scorePayload("quiz na tv", 40),
			popularity: 55,
			workspaceId: getTestWorkspaceId(),
		},
		{
			appRank: 3,
			classification: "sweet-spot",
			country: COUNTRY,
			day: dayOf(newer),
			difficulty: 34,
			keyword: "quiz na tv",
			opportunity: 70,
			payload: scorePayload("quiz na tv", 34),
			popularity: 55,
			workspaceId: getTestWorkspaceId(),
		},
	]);

	// The live listing targets "kalambury" (title) and "gry imprezowe" (keyword
	// field) - one is measured and invisible, the other is not tracked at all.
	await db.insert(listings).values({
		appId,
		keywords: "kalambury, gry imprezowe",
		language: "pl",
		shortDesc: "Domowka i quiz na tv",
		source: "remote",
		title: "Buzzin: kalambury na TV",
	});
});

afterAll(async () => {
	// Score snapshots are workspace-scoped, so deleting the store does not
	// cascade them away - they would leak into other suites' counts.
	await db
		.delete(keywordScoreSnapshots)
		.where(
			and(
				eq(keywordScoreSnapshots.country, COUNTRY),
				inArray(keywordScoreSnapshots.keyword, [
					"quiz na tv",
					"kalambury",
					"domowka",
				]),
			),
		);
	await cleanupStores(storeIds);
});

async function readBoard(country = COUNTRY): Promise<TrackingBoard> {
	const res = await app.handle(
		authRequest(`${BASE}/apps/${appId}/tracking/board?country=${country}`),
	);
	expect(res.status).toBe(200);
	return (await res.json()) as TrackingBoard;
}

describe("Tracking board", () => {
	it("joins position, score, leader and metadata into one row per keyword", async () => {
		const board = await readBoard();
		const row = board.keywords.find((k) => k.keyword === "quiz na tv");

		expect(row).toBeDefined();
		expect(row?.position).toBe(3);
		expect(row?.previousPosition).toBe(12);
		// Positive delta = moved up.
		expect(row?.delta).toBe(9);
		expect(row?.bestPosition).toBe(3);
		expect(row?.difficulty).toBe(34);
		expect(row?.difficultyLabel).toBe("easy");
		// Negative = the term got easier.
		expect(row?.difficultyDelta).toBe(-6);
		expect(row?.leader?.title).toBe("Rival App");
		expect(row?.leader?.ratingsCount).toBe(12000);
		expect(row?.pick).toBe(true);
		expect(row?.rankTrend.map((p) => p.position)).toEqual([12, 3]);
		expect(row?.scoreTrend.map((p) => p.difficulty)).toEqual([40, 34]);
		// "quiz na tv" sits in the subtitle of the live listing.
		expect(row?.metadataFields).toEqual(["subtitle"]);
	});

	it("reports entering and leaving the scan as events, not as a number", async () => {
		const board = await readBoard();
		const entered = board.movement.find((m) => m.keyword === "domowka");
		const dropped = board.movement.find((m) => m.keyword === "kalambury");
		const moved = board.movement.find((m) => m.keyword === "quiz na tv");

		expect(entered?.kind).toBe("entered");
		expect(entered?.from).toBeNull();
		expect(entered?.to).toBe(9);
		expect(dropped?.kind).toBe("dropped");
		expect(dropped?.from).toBe(44);
		expect(dropped?.to).toBeNull();
		expect(moved?.kind).toBe("moved");
		expect(moved?.from).toBe(12);
		expect(moved?.to).toBe(3);
	});

	it("summarises every measurement run, newest first", async () => {
		const board = await readBoard();
		expect(board.runs).toHaveLength(2);

		const [latest, previous] = board.runs;
		expect(latest.measured).toBe(3);
		expect(latest.ranked).toBe(2);
		expect(latest.top10).toBe(2);
		expect(latest.avgDifficulty).toBe(34);
		expect(previous.ranked).toBe(2);
		// #12 and #44 are both outside the first screen of results.
		expect(previous.top10).toBe(0);
	});

	it("separates 'in our metadata but not ranking' from 'never measured'", async () => {
		const board = await readBoard();
		const gap = board.metadataGap.find((g) => g.keyword === "kalambury");

		expect(gap).toBeDefined();
		expect(gap?.fields).toContain("title");
		expect(gap?.fields).toContain("keywords");
		// Ranked terms are not a gap.
		expect(board.metadataGap.some((g) => g.keyword === "quiz na tv")).toBe(
			false,
		);
		// A keyword-field term nobody tracks is a candidate, not a gap.
		expect(board.metadataUntracked).toContain("gry imprezowe");
	});

	it("counts the market and reports which markets exist", async () => {
		const board = await readBoard();
		expect(board.country).toBe(COUNTRY);
		expect(board.countries).toEqual([COUNTRY]);
		expect(board.language).toBe("pl");
		expect(board.stats.tracked).toBe(3);
		expect(board.stats.ranked).toBe(2);
		expect(board.stats.top10).toBe(2);
		expect(board.stats.runs).toBe(2);
		expect(board.stats.bestPosition).toBe(3);
	});

	it("stays empty for a market with no tracked keywords", async () => {
		const board = await readBoard("de");
		expect(board.keywords).toEqual([]);
		expect(board.movement).toEqual([]);
		expect(board.stats.tracked).toBe(0);
	});

	it("does not leak another workspace's board", async () => {
		const res = await app.handle(
			authRequestB(`${BASE}/apps/${appId}/tracking/board`),
		);
		expect(res.status).toBe(404);
	});

	it("keeps workspace B's own app reachable", async () => {
		const res = await app.handle(
			authRequestB(`${BASE}/apps/${appIdB}/tracking/board`),
		);
		expect(res.status).toBe(200);
	});
});

describe("Audit history", () => {
	it("builds the score timeline from recorded measurements", async () => {
		await AppEventsService.record(appId, "audit_scored", "Listing scored", {
			country: COUNTRY,
			draftScore: null,
			issues: 5,
			storeScore: 61,
		});
		await AppEventsService.record(appId, "audit_scored", "Listing scored", {
			country: COUNTRY,
			draftScore: 80,
			issues: 3,
			storeScore: 74,
		});

		const res = await app.handle(
			authRequest(`${BASE}/apps/${appId}/audit/history?country=${COUNTRY}`),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			points: Array<{ storeScore: number; draftScore: number | null }>;
			since: string | null;
		};
		// Oldest first, so a chart can read it left to right.
		expect(body.points.map((p) => p.storeScore)).toEqual([61, 74]);
		expect(body.points.at(-1)?.draftScore).toBe(80);
		expect(body.since).not.toBeNull();
	});

	it("ignores measurements from another market", async () => {
		await AppEventsService.record(appId, "audit_scored", "Listing scored", {
			country: "us",
			draftScore: null,
			issues: 1,
			storeScore: 90,
		});
		const res = await app.handle(
			authRequest(`${BASE}/apps/${appId}/audit/history?country=${COUNTRY}`),
		);
		const body = (await res.json()) as {
			points: Array<{ storeScore: number }>;
		};
		expect(body.points.some((p) => p.storeScore === 90)).toBe(false);
	});

	it("does not leak another workspace's audit history", async () => {
		const res = await app.handle(
			authRequestB(`${BASE}/apps/${appId}/audit/history`),
		);
		expect(res.status).toBe(404);
	});
});

describe("Board isolation from other workspaces' scores", () => {
	it("never reads a score snapshot belonging to another workspace", async () => {
		await db.insert(keywordScoreSnapshots).values({
			appRank: 1,
			classification: "sweet-spot",
			country: COUNTRY,
			day: dayOf(daysAgo(0)),
			difficulty: 99,
			keyword: "quiz na tv",
			opportunity: 1,
			payload: scorePayload("quiz na tv", 99),
			popularity: 1,
			workspaceId: getTestWorkspaceIdB(),
		});

		const board = await readBoard();
		const row = board.keywords.find((k) => k.keyword === "quiz na tv");
		// Workspace B's fresher row must not become our latest score.
		expect(row?.difficulty).toBe(34);

		await db
			.delete(keywordScoreSnapshots)
			.where(eq(keywordScoreSnapshots.workspaceId, getTestWorkspaceIdB()));
	});
});

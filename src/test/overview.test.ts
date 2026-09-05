import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { overviewController } from "@/modules/overview";
import type { OverviewResponse } from "@/modules/overview/overview.service";
import { db } from "@/utils/db";
import {
	appAudits,
	apps,
	rankSnapshots,
	reviews,
	stores,
	trackedKeywords,
} from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
} from "./setup";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(overviewController));

const URL = "http://localhost/api/overview";
const COUNTRY = "us";
const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_SYNCED_AT = new Date("2026-09-01T10:00:00.000Z");

const storeIds: string[] = [];
let iosAppId = "";
let androidAppId = "";

async function seedPublicStore(type: "app_store" | "google_play") {
	const [store] = await db
		.insert(stores)
		.values({
			connectionMode: "public",
			name: `${type} (public)`,
			status: "connected",
			type,
			workspaceId: getTestWorkspaceId(),
		})
		.returning();
	storeIds.push(store.id);
	return store.id;
}

async function seedIosApp() {
	const storeId = await seedPublicStore("app_store");
	const [row] = await db
		.insert(apps)
		.values({
			bundleId: "com.example.pomodoro",
			externalId: "555000111",
			iconUrl: "https://example.com/icon.png",
			lastSyncedAt: LAST_SYNCED_AT,
			name: "Pomo: Focus Timer",
			platform: "ios",
			rawData: {
				publicCountry: COUNTRY,
				storeFacts: { rating: 4.5, ratingsCount: 1200, version: "1.0" },
			},
			storeId,
		})
		.returning();
	return row.id;
}

async function seedAndroidApp() {
	const storeId = await seedPublicStore("google_play");
	const [row] = await db
		.insert(apps)
		.values({
			bundleId: "com.example.alpha",
			externalId: "com.example.alpha",
			name: "Alpha Tracker",
			platform: "android",
			rawData: { publicCountry: COUNTRY },
			storeId,
		})
		.returning();
	return row.id;
}

async function seedReviews(appId: string) {
	await db.insert(reviews).values([
		{
			appId,
			body: "Love it",
			externalId: "r-1",
			rating: 5,
			repliedAt: new Date(),
			replyText: "Thanks!",
			storeType: "app_store",
		},
		{
			appId,
			body: "Crashes on launch",
			externalId: "r-2",
			rating: 1,
			storeType: "app_store",
		},
	]);
}

async function seedAudits(readyAppId: string, measuringAppId: string) {
	await db.insert(appAudits).values([
		{
			appId: readyAppId,
			country: COUNTRY,
			draftScore: 80,
			status: "ready",
			storeScore: 70,
		},
		// A row that is still measuring carries placeholder scores and must not
		// surface on the dashboard.
		{
			appId: measuringAppId,
			country: COUNTRY,
			draftScore: 55,
			status: "measuring",
			storeScore: 40,
		},
	]);
}

async function seedTracking(appId: string) {
	await db.insert(trackedKeywords).values([
		{ appId, country: COUNTRY, keyword: "focus timer" },
		{ appId, country: COUNTRY, keyword: "pomodoro" },
	]);
	const now = Date.now();
	const older = new Date(now - 2 * DAY_MS);
	const latest = new Date(now - DAY_MS);
	await db.insert(rankSnapshots).values([
		// Older measurements that the latest ones must shadow.
		{
			appId,
			country: COUNTRY,
			createdAt: older,
			keyword: "focus timer",
			platform: "ios",
			position: 12,
		},
		{
			appId,
			country: COUNTRY,
			createdAt: older,
			keyword: "pomodoro",
			platform: "ios",
			position: null,
		},
		{
			appId,
			country: COUNTRY,
			createdAt: latest,
			keyword: "focus timer",
			platform: "ios",
			position: 5,
		},
		{
			appId,
			country: COUNTRY,
			createdAt: latest,
			keyword: "pomodoro",
			platform: "ios",
			position: 30,
		},
		// A keyword that is no longer tracked must not count anywhere.
		{
			appId,
			country: COUNTRY,
			createdAt: latest,
			keyword: "untracked",
			platform: "ios",
			position: 1,
		},
	]);
}

async function fetchOverview(request: Request): Promise<OverviewResponse> {
	const res = await app.handle(request);
	expect(res.status).toBe(200);
	return (await res.json()) as OverviewResponse;
}

describe("workspace overview", () => {
	beforeAll(async () => {
		iosAppId = await seedIosApp();
		androidAppId = await seedAndroidApp();
		await seedReviews(iosAppId);
		await seedAudits(iosAppId, androidAppId);
		await seedTracking(iosAppId);
	});

	afterAll(async () => {
		await cleanupStores(storeIds);
	});

	it("rejects unauthenticated requests", async () => {
		const res = await app.handle(new Request(URL));
		expect(res.status).toBe(401);
	});

	it("aggregates reviews, audit, ratings and rank stats per app", async () => {
		const body = await fetchOverview(authRequest(URL));

		expect(body.totals).toEqual({
			apps: 2,
			downloadsAvailable: false,
			reviewsUnanswered: 1,
			trackedKeywords: 2,
		});
		expect(body.apps.map((a) => a.name)).toEqual([
			"Alpha Tracker",
			"Pomo: Focus Timer",
		]);

		const ios = body.apps.find((a) => a.id === iosAppId);
		expect(ios).toEqual({
			auditScore: 70,
			avgPosition: 17.5,
			connectionMode: "public",
			draftScore: 80,
			iconUrl: "https://example.com/icon.png",
			id: iosAppId,
			lastSyncedAt: LAST_SYNCED_AT.toISOString(),
			name: "Pomo: Focus Timer",
			platform: "ios",
			reviewsTotal: 2,
			reviewsUnanswered: 1,
			storeRating: 4.5,
			storeRatingsCount: 1200,
			top10Count: 1,
			trackedKeywords: 2,
		});

		const android = body.apps.find((a) => a.id === androidAppId);
		expect(android).toEqual({
			auditScore: null,
			avgPosition: null,
			connectionMode: "public",
			draftScore: null,
			iconUrl: null,
			id: androidAppId,
			lastSyncedAt: null,
			name: "Alpha Tracker",
			platform: "android",
			reviewsTotal: 0,
			reviewsUnanswered: 0,
			storeRating: null,
			storeRatingsCount: null,
			top10Count: 0,
			trackedKeywords: 0,
		});
	});

	it("shows workspace B nothing from workspace A", async () => {
		const body = await fetchOverview(authRequestB(URL));
		expect(body.apps).toEqual([]);
		expect(body.totals).toEqual({
			apps: 0,
			downloadsAvailable: false,
			reviewsUnanswered: 0,
			trackedKeywords: 0,
		});
	});
});

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { trackingController } from "@/modules/tracking";
import { TrackingMarketsHistoryService } from "@/modules/tracking/markets-history.service";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
} from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { db } from "@/utils/db";
import { apps, rankSnapshots, trackedKeywords } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";

const BASE = "http://localhost/api";
/** 11:00 in Warsaw (CET, UTC+1 after the October clock change). */
const NOW = new Date("2026-11-04T10:00:00.000Z");

const server = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(trackingController));

const storeIds: string[] = [];
let appId: string;
let emptyAppId: string;

function get(path: string, b = false) {
	return server.handle((b ? authRequestB : authRequest)(`${BASE}${path}`));
}

function at(iso: string): Date {
	return new Date(iso);
}

beforeAll(async () => {
	const store = await seedTestStore();
	storeIds.push(store.id);
	const seeded = await seedTestApp(store.id);
	appId = seeded.id;
	await db
		.update(apps)
		.set({ name: "Buzzin: TV Party" })
		.where(eq(apps.id, appId));
	emptyAppId = (await seedTestApp(store.id)).id;

	const track = (country: string, keyword: string, createdAt: Date) => ({
		appId,
		country,
		createdAt,
		keyword,
	});
	await db.insert(trackedKeywords).values([
		track("pl", "buzzin", at("2026-10-01T10:00:00Z")),
		track("pl", "trivia", at("2026-10-01T10:00:00Z")),
		track("pl", "quiz", at("2026-10-01T10:00:00Z")),
		// Added today, never measured.
		track("pl", "party", at("2026-11-04T08:00:00Z")),
		// Added today, but imported history goes back further.
		track("pl", "late", at("2026-11-04T08:00:00Z")),
		track("us", "trivia", at("2026-10-01T10:00:00Z")),
		// Tracked, never measured: an empty market.
		track("de", "quiz", at("2026-10-01T10:00:00Z")),
	]);

	const snap = (
		country: string,
		keyword: string,
		position: number | null,
		createdAt: Date,
	) => ({
		appId,
		country,
		createdAt,
		keyword,
		platform: "playstore",
		position,
	});
	await db.insert(rankSnapshots).values([
		snap("pl", "buzzin", 1, at("2026-11-02T10:00:00Z")),
		snap("pl", "buzzin", 1, at("2026-11-03T10:00:00Z")),
		// 00:30 on 2 Nov in Warsaw although it is still 1 Nov in UTC.
		snap("pl", "trivia", 20, at("2026-11-01T23:30:00Z")),
		// The later check of the same day wins.
		snap("pl", "trivia", 15, at("2026-11-02T11:00:00Z")),
		snap("pl", "trivia", 8, at("2026-11-03T11:00:00Z")),
		// Before the window: where quiz and late stood when it opened.
		snap("pl", "quiz", 40, at("2026-10-30T11:00:00Z")),
		snap("pl", "late", 30, at("2026-11-01T11:00:00Z")),
		snap("pl", "quiz", null, at("2026-11-04T09:00:00Z")),
		snap("us", "trivia", 5, at("2026-11-03T11:00:00Z")),
		// No longer tracked: neither counted nor a measured day of its own.
		snap("us", "gone", 2, at("2026-11-02T11:00:00Z")),
	]);
});

afterAll(async () => {
	await cleanupStores(storeIds);
});

describe("TrackingMarketsHistoryService.getHistory", () => {
	it("counts each local day like the markets table", async () => {
		const history = await TrackingMarketsHistoryService.getHistory(
			appId,
			getTestWorkspaceId(),
			{ days: 3, now: NOW },
		);
		expect(history).toMatchObject({
			from: "2026-11-02",
			timeZone: "Europe/Warsaw",
			to: "2026-11-04",
		});
		expect(history.markets.map((m) => m.country)).toEqual(["de", "pl", "us"]);

		const pl = history.markets.find((m) => m.country === "pl");
		expect(pl?.points).toEqual([
			{
				day: "2026-11-02",
				measured: 2,
				median: 30,
				ranked: 3,
				top10: 0,
				top50: 3,
				tracked: 4,
			},
			{
				day: "2026-11-03",
				measured: 2,
				median: 30,
				ranked: 3,
				top10: 1,
				top50: 3,
				tracked: 4,
			},
			{
				day: "2026-11-04",
				measured: 1,
				median: 19,
				ranked: 2,
				top10: 1,
				top50: 2,
				tracked: 5,
			},
		]);

		const us = history.markets.find((m) => m.country === "us");
		expect(us?.points).toEqual([
			{
				day: "2026-11-03",
				measured: 1,
				median: 5,
				ranked: 1,
				top10: 1,
				top50: 1,
				tracked: 1,
			},
		]);
	});

	it("leaves out days and markets without a measurement", async () => {
		const history = await TrackingMarketsHistoryService.getHistory(
			appId,
			getTestWorkspaceId(),
			{ days: 3, now: NOW },
		);
		expect(history.markets.find((m) => m.country === "de")?.points).toEqual([]);

		// A one-day window that opens after the last measurement of us.
		const today = await TrackingMarketsHistoryService.getHistory(
			appId,
			getTestWorkspaceId(),
			{ days: 1, now: NOW },
		);
		expect(today.from).toBe("2026-11-04");
		expect(today.markets.find((m) => m.country === "us")?.points).toEqual([]);
		// Positions measured before the window still count on its first day.
		expect(today.markets.find((m) => m.country === "pl")?.points).toEqual([
			{
				day: "2026-11-04",
				measured: 1,
				median: 19,
				ranked: 2,
				top10: 1,
				top50: 2,
				tracked: 5,
			},
		]);
	});

	it("returns no markets for an app without tracked keywords", async () => {
		const history = await TrackingMarketsHistoryService.getHistory(
			emptyAppId,
			getTestWorkspaceId(),
			{ now: NOW },
		);
		expect(history.markets).toEqual([]);
		expect(history.from).toBe("2026-08-07");
	});

	it("ends on the same numbers as the live markets table", async () => {
		const markets = await get(`/apps/${appId}/tracking/markets`);
		const body = (await markets.json()) as {
			markets: Array<{
				country: string;
				earnedMedianPosition: number | null;
				earnedRanked: number;
				earnedTop10: number;
				earnedTop50: number;
				tracked: number;
			}>;
		};
		const history = await TrackingMarketsHistoryService.getHistory(
			appId,
			getTestWorkspaceId(),
			{ days: 30, now: NOW },
		);
		expect(history.markets.some((m) => m.points.length)).toBe(true);
		for (const market of body.markets) {
			const points = history.markets.find(
				(m) => m.country === market.country,
			)?.points;
			const last = points?.at(-1);
			if (!last) continue;
			expect(last).toMatchObject({
				median: market.earnedMedianPosition,
				ranked: market.earnedRanked,
				top10: market.earnedTop10,
				top50: market.earnedTop50,
				tracked: market.tracked,
			});
		}
	});
});

describe("GET /apps/:appId/tracking/markets/history", () => {
	it("defaults to a 90-day window in the scheduler time zone", async () => {
		const res = await get(`/apps/${appId}/tracking/markets/history`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			from: string;
			markets: Array<{ country: string }>;
			timeZone: string;
			to: string;
		};
		const span =
			(Date.parse(body.to) - Date.parse(body.from)) / (24 * 60 * 60 * 1000);
		expect(span).toBe(89);
		expect(body.timeZone).toBe("Europe/Warsaw");
		expect(body.markets.map((m) => m.country)).toEqual(["de", "pl", "us"]);
	});

	it("rejects a window outside 1-180 days", async () => {
		expect(
			(await get(`/apps/${appId}/tracking/markets/history?days=0`)).status,
		).toBe(422);
		expect(
			(await get(`/apps/${appId}/tracking/markets/history?days=181`)).status,
		).toBe(422);
	});

	it("workspace B cannot read workspace A's market history", async () => {
		expect(
			(await get(`/apps/${appId}/tracking/markets/history`, true)).status,
		).toBe(404);
	});
});

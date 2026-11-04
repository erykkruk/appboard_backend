import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { estimatedDailyDownloadsAt } from "@/modules/research/download-estimate";
import { KeywordScoresHistoryService } from "@/modules/research/keyword-scores-history.service";
import { estimateDownloads } from "@/modules/research/keyword-scoring";
import type { KeywordScore } from "@/modules/research/scoring-types";
import type { StorageResult } from "@/modules/store-performance/play-reports.storage";
import { StorePerformanceService } from "@/modules/store-performance/store-performance.service";
import type {
	MonthReport,
	SearchTermRow,
} from "@/modules/store-performance/store-performance.types";
import { trackingController } from "@/modules/tracking";
import {
	estimateAtRank,
	matchPlayKeywords,
	normalizeSearchTerm,
	playTermIndex,
	summarizeEstimates,
} from "@/modules/tracking/keyword-downloads.service";
import type { KeywordDownloadsReport } from "@/modules/tracking/keyword-downloads.types";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
	getTestWorkspaceIdB,
} from "@/test/setup";
import { encrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import {
	apps,
	keywordScoreSnapshots,
	rankSnapshots,
	stores,
	trackedKeywords,
} from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
import {
	BUZZIN_OCT_TRAFFIC,
	fixtureReport,
	TRAFFIC_FIXTURE,
	TV_OCT_TRAFFIC,
	utf16Report,
} from "./play-report-fixtures";

const BUCKET = "pubsite_prod_5411382577729402537";
const STORAGE_HOST = "storage.googleapis.com";
const NOV_TRAFFIC =
	"stats/store_performance/store_performance_tech.ravenlab.buzzin_202611_traffic_source.csv";
/** A market no other suite seeds, so the summary comparison sees only these rows. */
const COUNTRY = "is";
const POPULARITY = 42;

const server = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(trackingController));

const storeIds: string[] = [];
let bucketObjects = new Map<string, Uint8Array>();
let storageCalls = 0;

const realFetch = globalThis.fetch;
const realAccessToken = StorePerformanceService.accessToken;
const realNow = StorePerformanceService.now;

function fakeStorage(url: URL): Response {
	storageCalls += 1;
	const objectPrefix = `/storage/v1/b/${BUCKET}/o/`;
	if (url.pathname.startsWith(objectPrefix)) {
		const name = decodeURIComponent(url.pathname.slice(objectPrefix.length));
		const bytes = bucketObjects.get(name);
		return bytes
			? new Response(Buffer.from(bytes), { status: 200 })
			: new Response("No such object", { status: 404 });
	}
	if (url.pathname === `/storage/v1/b/${BUCKET}/o`) {
		const prefix = url.searchParams.get("prefix") ?? "";
		return Response.json({
			items: [...bucketObjects.keys()]
				.filter((name) => name.startsWith(prefix))
				.map((name) => ({ name })),
		});
	}
	return new Response("The specified bucket does not exist.", { status: 404 });
}

/** November so far: search terms in the spellings people actually type. */
function novemberTraffic(): Uint8Array {
	const row = (term: string, source: string, acq: string, vis: string) => [
		"2026-11-02",
		"tech.ravenlab.buzzin",
		source,
		term,
		"Other",
		"Other",
		acq,
		vis,
		"0.5",
	];
	return utf16Report(TRAFFIC_FIXTURE.columns, [
		row("Buzzin", "Google Play search", "12", "15"),
		row("glowka  pracuje", "Google Play search", "2", "3"),
		row("główka pracuje", "Google Play search", "1", "2"),
		row("Other", "Other", "40", "60"),
		row("No search terms specified", "Ads and referrals", "30", "35"),
	]);
}

function scorePayload(keyword: string, popularity: number): KeywordScore {
	const tier = {
		freshCount: 0,
		label: "reachable",
		medianReviews: 10,
		minReviews: 1,
		tierScore: 30,
		titleKeywordCount: 1,
		totalApps: 25,
		weakCount: 1,
		weakestApp: null,
	};
	return {
		breakdown: {
			avgReviews: 1,
			brandName: null,
			dominantPlayers: 1,
			isBrandKeyword: false,
			marketAge: 1,
			medianReviews: 1,
			overrideReason: null,
			publisherDiversity: 1,
			ratingQuality: 1,
			ratingVolume: 1,
			rawTotal: 30,
			reviewVelocity: 1,
			titleMatchCount: 1,
			titleRelevance: 1,
		},
		classification: "sweet-spot",
		competitors: [],
		country: COUNTRY,
		difficulty: 30,
		difficultyLabel: "easy",
		downloads: estimateDownloads(popularity, COUNTRY),
		keyword,
		opportunity: 60,
		popularity,
		tiers: { top5: tier, top10: tier, top20: tier },
	};
}

async function seedStore(
	type: "google_play" | "app_store",
	workspaceId?: string,
) {
	const [store] = await db
		.insert(stores)
		.values({
			connectionMode: "api",
			credentials: encrypt(
				JSON.stringify({
					client_email: "appboard-play@example-project.iam.gserviceaccount.com",
					private_key:
						"-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
				}),
			),
			name: "Store",
			playReportsBucket: type === "google_play" ? BUCKET : null,
			status: "connected",
			type,
			workspaceId: workspaceId ?? getTestWorkspaceId(),
		})
		.returning();
	storeIds.push(store.id);
	return store;
}

async function seedApp(
	storeId: string,
	platform: "android" | "ios",
	options: { devices?: Array<"phone" | "tv">; externalId?: string } = {},
) {
	const externalId =
		options.externalId ??
		(platform === "android" ? "tech.ravenlab.buzzin" : "6787068440");
	const [row] = await db
		.insert(apps)
		.values({
			bundleId: externalId,
			devices: options.devices ?? ["phone"],
			externalId,
			name: "Buzzin",
			platform,
			storeId,
		})
		.returning();
	return row;
}

async function getDownloads(appId: string, query = "", asB = false) {
	const url = `http://localhost/api/apps/${appId}/tracking/keyword-downloads${query}`;
	const response = await server.handle(
		asB ? authRequestB(url) : authRequest(url),
	);
	return {
		body: (await response.json()) as KeywordDownloadsReport,
		status: response.status,
	};
}

function monthOf(
	searchTerms: SearchTermRow[] | null,
	month: string,
): MonthReport {
	return {
		countries: null,
		files: {
			country: false,
			installs: false,
			trafficSource: searchTerms !== null,
		},
		installs: null,
		lastDay: searchTerms ? `${month}-02` : null,
		month,
		traffic: searchTerms
			? {
					campaigns: [],
					searchTermPlaceholders: [],
					searchTerms,
					sources: [],
					totals: { acquisitions: 0, conversionRate: null, visitors: 0 },
				}
			: null,
	};
}

const term = (
	name: string,
	acquisitions: number,
	visitors: number,
): SearchTermRow => ({
	acquisitions,
	conversionRate: visitors ? acquisitions / visitors : null,
	term: name,
	visitors,
});

describe("Play search term matching", () => {
	it("ignores case, spacing and accents, including letters NFD cannot split", () => {
		expect(normalizeSearchTerm("  Główka   Pracuje ")).toBe("glowka pracuje");
		expect(normalizeSearchTerm("WISSEN IST MACHT")).toBe("wissen ist macht");
		expect(normalizeSearchTerm("Straße\tquiz")).toBe("strasse quiz");
		expect(normalizeSearchTerm("saber es poder")).toBe(
			normalizeSearchTerm("sabér es pódér"),
		);
	});

	it("sums spellings that fold together and never treats Play labels as keywords", () => {
		const index = playTermIndex([
			term("główka pracuje", 1, 2),
			term("glowka  pracuje", 2, 3),
			term("Other", 40, 60),
			term("No search terms specified", 30, 35),
		]);
		expect([...index.keys()]).toEqual(["glowka pracuje"]);
		expect(index.get("glowka pracuje")).toEqual({
			acquisitions: 3,
			terms: ["główka pracuje", "glowka  pracuje"],
			visitors: 5,
		});
	});

	it("reads the latest full month and the month to date separately", () => {
		const matched = matchPlayKeywords(["buzzin", "other", "quiz na tv"], {
			current: monthOf([term("buzzin", 12, 15)], "2026-11"),
			latest: monthOf(
				[term("buzzin", 509, 590), term("other", 1, 1)],
				"2026-10",
			),
		});
		expect(matched.get("buzzin")).toEqual({
			currentMonth: { acquisitions: 12, visitors: 15 },
			latestMonth: { acquisitions: 509, visitors: 590 },
			terms: ["buzzin"],
		});
		// "other" is a Play placeholder, even when someone tracks it as a keyword.
		expect(matched.get("other")?.latestMonth).toBeNull();
		expect(matched.get("quiz na tv")).toEqual({
			currentMonth: null,
			latestMonth: null,
			terms: [],
		});
	});

	it("answers null for a month Play has not written yet", () => {
		const matched = matchPlayKeywords(["buzzin"], {
			current: monthOf(null, "2026-11"),
			latest: monthOf([term("buzzin", 509, 590)], "2026-10"),
		});
		expect(matched.get("buzzin")?.currentMonth).toBeNull();
		expect(matched.get("buzzin")?.latestMonth?.acquisitions).toBe(509);
	});
});

describe("App Store estimate at the current rank", () => {
	const curve = estimateDownloads(POPULARITY, COUNTRY);
	const score = { day: "2026-11-04", downloads: curve, popularity: POPULARITY };

	it("is the keyword score's own download curve at the position", () => {
		const estimate = estimateAtRank(score, 3);
		expect(estimate?.perDay).toEqual({
			high: curve.positions[2].high,
			low: curve.positions[2].low,
		});
		expect(estimate?.perDay).toEqual(
			estimatedDailyDownloadsAt(curve, 3) ?? undefined,
		);
		expect(estimate?.perMonth.high).toBeCloseTo(
			curve.positions[2].high * 30,
			2,
		);
		expect(estimate?.beyondModel).toBe(false);
	});

	it("is zero past the modelled top 20 and absent without a rank or a score", () => {
		expect(estimateAtRank(score, 37)).toMatchObject({
			beyondModel: true,
			perDay: { high: 0, low: 0 },
		});
		expect(estimateAtRank(score, null)).toBeNull();
		expect(estimateAtRank(null, 3)).toBeNull();
		expect(estimateAtRank({ ...score, downloads: null }, 3)).toBeNull();
	});

	it("totals only keywords that carry an estimate", () => {
		const one = estimateAtRank(score, 1);
		const summary = summarizeEstimates(
			[
				{ estimate: one, keyword: "a", play: null },
				{ estimate: null, keyword: "b", play: null },
			],
			2,
		);
		expect(summary.ranked).toBe(1);
		expect(summary.scored).toBe(2);
		expect(summary.perDay).toEqual(one?.perDay ?? { high: -1, low: -1 });
	});
});

describe("GET /apps/:appId/tracking/keyword-downloads", () => {
	let androidId: string;
	let tvId: string;
	let iosId: string;
	let iosBId: string;

	const clearSnapshots = () =>
		db
			.delete(keywordScoreSnapshots)
			.where(
				and(
					eq(keywordScoreSnapshots.country, COUNTRY),
					inArray(keywordScoreSnapshots.workspaceId, [
						getTestWorkspaceId(),
						getTestWorkspaceIdB(),
					]),
				),
			);

	beforeAll(async () => {
		await clearSnapshots();
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.host === STORAGE_HOST) return fakeStorage(url);
			return realFetch(input, init);
		}) as typeof fetch;
		StorePerformanceService.accessToken = async (): Promise<
			StorageResult<string>
		> => ({ ok: true, value: "test-token" });
		StorePerformanceService.now = () => new Date("2026-11-04T09:00:00Z");

		const play = await seedStore("google_play");
		androidId = (await seedApp(play.id, "android")).id;
		tvId = (
			await seedApp(play.id, "android", {
				devices: ["tv"],
				externalId: "com.playbuzzin.tv",
			})
		).id;
		const appStore = await seedStore("app_store");
		iosId = (await seedApp(appStore.id, "ios")).id;
		const appStoreB = await seedStore("app_store", getTestWorkspaceIdB());
		iosBId = (await seedApp(appStoreB.id, "ios")).id;

		const tracked = ["buzzin", "główka pracuje", "quiz na tv", "kalambury"];
		await db.insert(trackedKeywords).values([
			...tracked.map((keyword) => ({
				appId: androidId,
				country: COUNTRY,
				keyword,
			})),
			{ appId: tvId, country: COUNTRY, keyword: "buzzin" },
			...tracked.map((keyword) => ({
				appId: iosId,
				country: COUNTRY,
				keyword,
			})),
			{ appId: iosId, country: "us", keyword: "buzzin" },
			{ appId: iosBId, country: COUNTRY, keyword: "buzzin" },
		]);

		const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const today = new Date();
		await db.insert(rankSnapshots).values([
			// Older check first: only the newest position may drive the estimate.
			{
				appId: iosId,
				country: COUNTRY,
				createdAt: yesterday,
				keyword: "buzzin",
				platform: "appstore",
				position: 9,
			},
			{
				appId: iosId,
				country: COUNTRY,
				createdAt: today,
				keyword: "buzzin",
				platform: "appstore",
				position: 1,
			},
			{
				appId: iosId,
				country: COUNTRY,
				createdAt: today,
				keyword: "quiz na tv",
				platform: "appstore",
				position: 37,
			},
			{
				appId: iosId,
				country: COUNTRY,
				createdAt: today,
				keyword: "kalambury",
				platform: "appstore",
				position: null,
			},
		]);

		const day = today.toISOString().slice(0, 10);
		const snapshot = (
			keyword: string,
			workspaceId: string,
			popularity: number,
			appRank: number | null,
		) => ({
			appRank,
			classification: "sweet-spot",
			country: COUNTRY,
			day,
			difficulty: 30,
			keyword,
			opportunity: 60,
			payload: scorePayload(keyword, popularity),
			popularity,
			workspaceId,
		});
		await db.insert(keywordScoreSnapshots).values([
			snapshot("buzzin", getTestWorkspaceId(), POPULARITY, 1),
			snapshot("quiz na tv", getTestWorkspaceId(), 35, 37),
			snapshot("kalambury", getTestWorkspaceId(), 30, null),
			// Workspace B scored the same phrase much higher: must never leak into A.
			snapshot("główka pracuje", getTestWorkspaceIdB(), 90, 1),
		]);
	});

	afterAll(async () => {
		globalThis.fetch = realFetch;
		StorePerformanceService.accessToken = realAccessToken;
		StorePerformanceService.now = realNow;
		await clearSnapshots();
		await cleanupStores(storeIds);
	});

	beforeEach(() => {
		StorePerformanceService.clearCache();
		storageCalls = 0;
		bucketObjects = new Map([
			[BUZZIN_OCT_TRAFFIC, fixtureReport(BUZZIN_OCT_TRAFFIC)],
			[NOV_TRAFFIC, novemberTraffic()],
			[TV_OCT_TRAFFIC, fixtureReport(TV_OCT_TRAFFIC)],
		]);
	});

	it("gives Google Play keywords their real installs from the Play report", async () => {
		const { body, status } = await getDownloads(
			androidId,
			`?country=${COUNTRY}`,
		);
		expect(status).toBe(200);
		expect(body.source).toBe("google_play_report");
		expect(body.play).toMatchObject({
			currentMonth: {
				available: true,
				lastDay: "2026-11-02",
				month: "2026-11",
				searchInstalls: 15,
			},
			latestMonth: {
				available: true,
				month: "2026-10",
				searchInstalls: 509,
				searchVisitors: 590,
			},
			scope: "all_countries",
			status: "ok",
			tvOnly: false,
		});
		const byKeyword = new Map(body.keywords.map((k) => [k.keyword, k]));
		expect(byKeyword.get("buzzin")?.play).toEqual({
			currentMonth: { acquisitions: 12, visitors: 15 },
			latestMonth: { acquisitions: 509, visitors: 590 },
			terms: ["buzzin"],
		});
		expect(byKeyword.get("główka pracuje")?.play).toMatchObject({
			currentMonth: { acquisitions: 3, visitors: 5 },
			latestMonth: null,
		});
		expect(byKeyword.get("quiz na tv")?.play).toEqual({
			currentMonth: null,
			latestMonth: null,
			terms: [],
		});
		expect(body.keywords.every((k) => k.estimate === null)).toBe(true);
	});

	it("serves a second read from the report cache without touching the bucket", async () => {
		await getDownloads(androidId);
		const afterFirst = storageCalls;
		await getDownloads(androidId);
		expect(afterFirst).toBeGreaterThan(0);
		expect(storageCalls).toBe(afterFirst);
	});

	it("says so when Play reports a TV app without any search term", async () => {
		const { body } = await getDownloads(tvId);
		expect(body.play?.tvOnly).toBe(true);
		expect(body.keywords[0].play?.latestMonth).toBeNull();
	});

	it("passes the bucket problem through instead of showing zeros", async () => {
		const store = await seedStore("google_play");
		await db
			.update(stores)
			.set({ playReportsBucket: null })
			.where(eq(stores.id, store.id));
		const app = await seedApp(store.id, "android", {
			externalId: "com.example.nobucket",
		});
		await db
			.insert(trackedKeywords)
			.values({ appId: app.id, country: COUNTRY, keyword: "buzzin" });
		const { body } = await getDownloads(app.id);
		expect(body.play?.status).toBe("bucket_missing");
		expect(body.play?.message).toContain("Play reports bucket");
		expect(body.keywords).toEqual([
			{ estimate: null, keyword: "buzzin", play: null },
		]);
	});

	it("estimates App Store downloads with the keyword score's model at the current rank", async () => {
		const { body, status } = await getDownloads(iosId, `?country=${COUNTRY}`);
		expect(status).toBe(200);
		expect(body.source).toBe("app_store_estimate");
		expect(body.play).toBeNull();
		const curve = estimateDownloads(POPULARITY, COUNTRY);
		const byKeyword = new Map(body.keywords.map((k) => [k.keyword, k]));
		expect(byKeyword.get("buzzin")?.estimate).toMatchObject({
			beyondModel: false,
			perDay: { high: curve.positions[0].high, low: curve.positions[0].low },
			popularity: POPULARITY,
			position: 1,
		});
		expect(byKeyword.get("quiz na tv")?.estimate).toMatchObject({
			beyondModel: true,
			perDay: { high: 0, low: 0 },
			position: 37,
		});
		// Scored but not ranked, and ranked nowhere with no score of our own.
		expect(byKeyword.get("kalambury")?.estimate).toBeNull();
		expect(byKeyword.get("główka pracuje")?.estimate).toBeNull();
		expect(body.estimate).toMatchObject({
			daysPerMonth: 30,
			perDay: { high: curve.positions[0].high, low: curve.positions[0].low },
			ranked: 2,
			scored: 3,
		});
	});

	it("matches the keyword score summary's download interval for the same ranks", async () => {
		const { body } = await getDownloads(iosId, `?country=${COUNTRY}`);
		const summary = await KeywordScoresHistoryService.summary(
			getTestWorkspaceId(),
		);
		const pl = summary.find((s) => s.country === COUNTRY);
		expect(pl?.estimatedDailyDownloads).toEqual(body.estimate?.perDay);
	});

	it("serves one market at a time", async () => {
		const { body } = await getDownloads(iosId, "?country=us");
		expect(body.country).toBe("us");
		expect(body.keywords.map((k) => k.keyword)).toEqual(["buzzin"]);
		expect(body.keywords[0].estimate).toBeNull();
	});

	it("keeps workspaces apart", async () => {
		expect((await getDownloads(iosId, "", true)).status).toBe(404);
		expect((await getDownloads(androidId, "", true)).status).toBe(404);
		const own = await getDownloads(iosBId, "", true);
		expect(own.status).toBe(200);
		expect(own.body.keywords).toEqual([
			{ estimate: null, keyword: "buzzin", play: null },
		]);
	});
});

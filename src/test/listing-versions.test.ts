import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { ResearchService } from "@/modules/research/research.service";
import { trackingController } from "@/modules/tracking";
import {
	ListingVersionService,
	listingFingerprint,
	marketListingLanguage,
	releaseAt,
} from "@/modules/tracking/listing-versions.service";
import type { RankByVersion } from "@/modules/tracking/listing-versions.types";
import { RankCheckJobs } from "@/modules/tracking/rank-check.jobs";
import { configureRankLookup } from "@/modules/tracking/rank-lookup";
import {
	parseAppStoreVersionHistory,
	type StoreRelease,
	type StoreVersionSource,
} from "@/modules/tracking/store-versions";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceIdB,
} from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { db } from "@/utils/db";
import {
	apps,
	appVersions,
	listings,
	rankSnapshots,
	trackedKeywords,
	versionLocalizations,
} from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";

const BASE = "http://localhost/api";
const DAY_MS = 86_400_000;

const server = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(appsController).use(trackingController));

/** A store whose live version the test sets; `null` = the lookup fails. */
function fakeVersions(initial: StoreRelease | null): {
	history: StoreRelease[];
	live: StoreRelease | null;
	source: StoreVersionSource;
} {
	const state = {
		history: [] as StoreRelease[],
		live: initial,
		source: {} as StoreVersionSource,
	};
	state.source = {
		history: async () => state.history,
		live: async () => {
			if (!state.live) throw new Error("store unavailable");
			return state.live;
		},
	};
	return state;
}

const storeIds: string[] = [];

beforeAll(async () => {
	const store = await seedTestStore();
	const storeB = await seedTestStore(getTestWorkspaceIdB());
	storeIds.push(store.id, storeB.id);
});

afterAll(async () => {
	configureRankLookup();
	await cleanupStores(storeIds);
});

async function runCheck(appId: string, position: number) {
	const spy = spyOn(ResearchService, "positionFor").mockResolvedValue(position);
	try {
		const res = await server.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/check`, { method: "POST" }),
		);
		expect(res.status).toBe(202);
		await RankCheckJobs.waitFor(appId);
	} finally {
		spy.mockRestore();
	}
}

async function byVersion(appId: string, country: string) {
	const res = await server.handle(
		authRequest(`${BASE}/apps/${appId}/tracking/by-version?country=${country}`),
	);
	expect(res.status).toBe(200);
	return (await res.json()) as RankByVersion;
}

async function seedTrackedApp(): Promise<string> {
	const app = await seedTestApp(storeIds[0]);
	await db.insert(listings).values([
		{
			appId: app.id,
			keywords: null,
			language: "en-US",
			shortDesc: "Plan your day",
			source: "remote",
			title: "Task Master",
		},
		{
			appId: app.id,
			language: "pl-PL",
			shortDesc: "Zaplanuj dzien",
			source: "remote",
			title: "Mistrz zadan",
		},
	]);
	await db.insert(trackedKeywords).values([
		{ appId: app.id, country: "us", keyword: "todo", starred: true },
		{ appId: app.id, country: "us", keyword: "planner" },
		{ appId: app.id, country: "pl", keyword: "lista zadan" },
	]);
	return app.id;
}

describe("listingFingerprint", () => {
	const base = {
		keywords: "todo,planner",
		language: "en-US",
		subtitle: "Plan your day",
		title: "Task Master",
		versionReleasedAt: null,
		versionString: "1.0.0",
	};

	it("is stable for the same state and ignores surrounding whitespace", () => {
		// Arrange
		const padded = { ...base, title: "  Task Master " };
		// Act + Assert
		expect(listingFingerprint(padded)).toBe(listingFingerprint(base));
	});

	it("changes when the version or any ranking field changes", () => {
		const original = listingFingerprint(base);
		expect(listingFingerprint({ ...base, versionString: "1.0.1" })).not.toBe(
			original,
		);
		expect(listingFingerprint({ ...base, keywords: "todo" })).not.toBe(
			original,
		);
		expect(listingFingerprint({ ...base, subtitle: null })).not.toBe(original);
	});

	it("does not depend on the release date", () => {
		expect(
			listingFingerprint({ ...base, versionReleasedAt: new Date(0) }),
		).toBe(listingFingerprint(base));
	});
});

describe("marketListingLanguage", () => {
	it("prefers the regional variant of the market", () => {
		expect(marketListingLanguage("gb", ["en-US", "en-GB"])).toBe("en-GB");
		expect(marketListingLanguage("mx", ["es-ES", "es-MX"])).toBe("es-MX");
		expect(marketListingLanguage("br", ["pt-PT", "pt-BR"])).toBe("pt-BR");
	});

	it("falls back to the main variant and to Latin American Spanish", () => {
		expect(marketListingLanguage("us", ["en-AU", "en-US"])).toBe("en-US");
		expect(marketListingLanguage("ie", ["en-AU", "en-US"])).toBe("en-US");
		expect(marketListingLanguage("ar", ["es-ES", "es-419"])).toBe("es-419");
		expect(marketListingLanguage("es", ["es-ES", "es-419"])).toBe("es-ES");
	});

	it("matches bare and store-specific language codes", () => {
		expect(marketListingLanguage("pl", ["en-US", "pl"])).toBe("pl");
		expect(marketListingLanguage("pl", ["en-US", "pl-PL"])).toBe("pl-PL");
		expect(marketListingLanguage("no", ["no-NO"])).toBe("no-NO");
		expect(marketListingLanguage("il", ["iw-IL"])).toBe("iw-IL");
		expect(marketListingLanguage("sk", ["en-US", "sk"])).toBe("sk");
		// Country codes that are also language codes mean the country.
		expect(marketListingLanguage("ca", ["ca", "en-US", "en-CA"])).toBe("en-CA");
		expect(marketListingLanguage("tw", ["zh-Hans", "zh-Hant"])).toBe("zh-Hant");
		expect(marketListingLanguage("cn", ["zh-Hans", "zh-Hant"])).toBe("zh-Hans");
	});

	it("returns null when the app has no listing in the market's language", () => {
		expect(marketListingLanguage("jp", ["en-US", "de-DE"])).toBeNull();
		expect(marketListingLanguage("us", [])).toBeNull();
	});
});

describe("parseAppStoreVersionHistory", () => {
	const entry = (version: string, date: string) =>
		`{"$kind":"TitledParagraph","text":"Fixes","primarySubtitle":"${version}","secondarySubtitle":"${date}"}`;

	it("reads the version history sheet oldest first", () => {
		// Arrange
		const html = `<script>{"mostRecentVersion":{"items":[${entry("9.9.9", "Mon Nov 02 2026 23:23:18 GMT+0000 (Coordinated Universal Time)")}]},"page":"versionHistory","pageData":{"shelves":[{"items":[${[
			entry(
				"1.7.5",
				"Mon Nov 02 2026 23:23:18 GMT+0000 (Coordinated Universal Time)",
			),
			entry(
				"1.7.4",
				"Fri Oct 30 2026 20:04:58 GMT+0000 (Coordinated Universal Time)",
			),
			entry(
				"1.7.4",
				"Fri Oct 30 2026 20:04:58 GMT+0000 (Coordinated Universal Time)",
			),
			entry("1.7.3", "not a date"),
		].join(",")}]}]}}</script>`;

		// Act
		const releases = parseAppStoreVersionHistory(html);

		// Assert
		expect(releases.map((r) => r.versionString)).toEqual(["1.7.4", "1.7.5"]);
		expect(releases[1].releasedAt?.toISOString()).toBe(
			"2026-11-02T23:23:18.000Z",
		);
	});

	it("returns nothing when the page has no history", () => {
		expect(parseAppStoreVersionHistory("<html></html>")).toEqual([]);
	});
});

describe("releaseAt", () => {
	const releases: StoreRelease[] = [
		{ releasedAt: new Date("2026-10-01T00:00:00Z"), versionString: "1.0" },
		{ releasedAt: new Date("2026-10-10T00:00:00Z"), versionString: "1.1" },
	];

	it("picks the release live at the given time", () => {
		expect(
			releaseAt(releases, new Date("2026-10-05T00:00:00Z"))?.versionString,
		).toBe("1.0");
		expect(
			releaseAt(releases, new Date("2026-10-10T00:00:00Z"))?.versionString,
		).toBe("1.1");
	});

	it("returns null before the oldest known release", () => {
		expect(releaseAt(releases, new Date("2026-09-01T00:00:00Z"))).toBeNull();
	});
});

describe("Rank check records the live listing version", () => {
	it("tags snapshots with the version and splits positions per version", async () => {
		// Arrange
		const appId = await seedTrackedApp();
		const store = fakeVersions({
			releasedAt: new Date("2026-10-01T00:00:00Z"),
			versionString: "1.0.0",
		});
		configureRankLookup({
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
			versions: store.source,
		});

		// Act: one check on 1.0.0, then a release with a new title, one more check.
		await runCheck(appId, 7);
		store.live = {
			releasedAt: new Date("2026-10-20T00:00:00Z"),
			versionString: "1.1.0",
		};
		await db
			.update(listings)
			.set({ title: "Task Master: Planner" })
			.where(and(eq(listings.appId, appId), eq(listings.language, "en-US")));
		await runCheck(appId, 3);
		const us = await byVersion(appId, "us");

		// Assert
		expect(us.versions.map((v) => v.key)).toEqual(["1.1.0", "1.0.0"]);
		const [newest, oldest] = us.versions;
		expect(newest.listing?.title).toBe("Task Master: Planner");
		expect(oldest.listing?.title).toBe("Task Master");
		expect(newest.changedFields).toEqual(["title"]);
		expect(newest.inferred).toBe(false);
		expect(newest.releasedAt).toBe("2026-10-20T00:00:00.000Z");
		expect(newest.listings[0].language).toBe("en-US");

		const todo = us.keywords.find((k) => k.keyword === "todo");
		expect(us.keywords[0].keyword).toBe("todo");
		expect(todo?.starred).toBe(true);
		expect(todo?.cells["1.0.0"]).toMatchObject({
			best: 7,
			delta: null,
			last: 7,
			measurements: 1,
			ranked: 1,
		});
		expect(todo?.cells["1.1.0"]).toMatchObject({ delta: 4, last: 3 });

		// The Polish market got its own listing text under the same version.
		const pl = await byVersion(appId, "pl");
		expect(pl.versions[0].listing?.title).toBe("Mistrz zadan");

		// The chart history carries the version of every measurement.
		const history = await server.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/history?country=us`),
		);
		const h = (await history.json()) as {
			snapshots: Array<{ version: string | null }>;
		};
		expect(h.snapshots.map((s) => s.version)).toEqual([
			"1.0.0",
			"1.0.0",
			"1.1.0",
			"1.1.0",
		]);
	});

	it("reuses the state while nothing changes", async () => {
		const appId = await seedTrackedApp();
		const store = fakeVersions({ releasedAt: null, versionString: "2.0" });
		configureRankLookup({
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
			versions: store.source,
		});

		await runCheck(appId, 5);
		await runCheck(appId, 6);

		const rows = await db
			.selectDistinct({ id: rankSnapshots.listingVersionId })
			.from(rankSnapshots)
			.where(eq(rankSnapshots.appId, appId));
		// One state per market language (en-US for us, pl-PL for pl).
		expect(rows).toHaveLength(2);
		const us = await byVersion(appId, "us");
		expect(us.versions).toHaveLength(1);
		expect(us.versions[0].measurements).toBe(4);
		expect(
			us.keywords.find((k) => k.keyword === "todo")?.cells["2.0"]?.last,
		).toBe(6);
	});

	it("still measures when the store version cannot be read", async () => {
		const appId = await seedTrackedApp();
		configureRankLookup({
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
			versions: fakeVersions(null).source,
		});

		await runCheck(appId, 9);

		const us = await byVersion(appId, "us");
		expect(us.versions.map((v) => v.key)).toEqual(["unknown"]);
		expect(us.versions[0].versionString).toBeNull();
		// The text is still known even without the version.
		expect(us.versions[0].listing?.title).toBe("Task Master");
		expect(
			us.keywords.find((k) => k.keyword === "todo")?.cells.unknown?.last,
		).toBe(9);
	});
});

describe("Backfill from the store's version history", () => {
	it("attributes old snapshots to the release live then, marked inferred", async () => {
		// Arrange: snapshots before, between and after two releases.
		const appId = await seedTrackedApp();
		const now = Date.now();
		const r1 = new Date(now - 10 * DAY_MS);
		const r2 = new Date(now - 5 * DAY_MS);
		await db.insert(rankSnapshots).values([
			{
				appId,
				country: "us",
				createdAt: new Date(now - 12 * DAY_MS),
				keyword: "todo",
				platform: "playstore",
				position: 20,
			},
			{
				appId,
				country: "us",
				createdAt: new Date(now - 8 * DAY_MS),
				keyword: "todo",
				platform: "playstore",
				position: 12,
			},
			{
				appId,
				country: "us",
				createdAt: new Date(now - 7 * DAY_MS),
				keyword: "todo",
				platform: "playstore",
				position: 10,
			},
			{
				appId,
				country: "us",
				createdAt: new Date(now - 2 * DAY_MS),
				keyword: "todo",
				platform: "playstore",
				position: 4,
			},
		]);
		const store = fakeVersions(null);
		store.history = [
			{ releasedAt: r2, versionString: "1.1" },
			{ releasedAt: r1, versionString: "1.0" },
		];
		const runtime = configureRankLookup({
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
			versions: store.source,
		});
		const app = {
			externalId: "com.example.taskmaster",
			id: appId,
			platform: "android",
		};

		// Act
		const result = await ListingVersionService.backfill(
			app,
			"playstore",
			"us",
			runtime,
		);
		const again = await ListingVersionService.backfill(
			app,
			"playstore",
			"us",
			runtime,
		);

		// Assert
		expect(result).toEqual({ attributed: 3, unknown: 1 });
		expect(again).toBeNull();
		const us = await byVersion(appId, "us");
		expect(us.versions.map((v) => v.key)).toEqual(["1.1", "1.0", "unknown"]);
		expect(us.versions[0].inferred).toBe(true);
		expect(us.versions[2].inferred).toBe(false);
		const todo = us.keywords.find((k) => k.keyword === "todo");
		expect(todo?.cells["1.0"]).toMatchObject({
			best: 10,
			last: 10,
			measurements: 2,
		});
		expect(todo?.cells["1.1"]).toMatchObject({ delta: 6, last: 4 });
		// Play keeps no text history: an inferred state knows only the version.
		expect(us.versions[0].listing).toEqual({
			keywords: null,
			subtitle: null,
			title: null,
		});
	});

	it("tries again on the next run when the history could not be read", async () => {
		const appId = await seedTrackedApp();
		await db.insert(rankSnapshots).values({
			appId,
			country: "us",
			createdAt: new Date(Date.now() - DAY_MS),
			keyword: "todo",
			platform: "playstore",
			position: 2,
		});
		const failing: StoreVersionSource = {
			history: async () => {
				throw new Error("store unavailable");
			},
			live: async () => null,
		};
		const runtime = configureRankLookup({
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
			versions: failing,
		});
		const app = {
			externalId: "com.example.taskmaster",
			id: appId,
			platform: "android",
		};

		expect(
			await ListingVersionService.backfill(app, "playstore", "us", runtime),
		).toBeNull();

		const store = fakeVersions(null);
		store.history = [
			{ releasedAt: new Date(Date.now() - 3 * DAY_MS), versionString: "3.0" },
		];
		const retry = configureRankLookup({
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
			versions: store.source,
		});
		expect(
			await ListingVersionService.backfill(app, "playstore", "us", retry),
		).toEqual({
			attributed: 1,
			unknown: 0,
		});
	});
});

describe("iOS listing text per version", () => {
	it("reads the live version's localization; history keeps only its keywords", async () => {
		// Arrange
		const store = await seedTestStore();
		storeIds.push(store.id);
		const [app] = await db
			.insert(apps)
			.values({
				bundleId: "com.test.ios",
				externalId: "123456",
				name: "iOS App",
				platform: "ios",
				storeId: store.id,
			})
			.returning();
		const [v1] = await db
			.insert(appVersions)
			.values({
				appId: app.id,
				externalId: "v1",
				state: "READY_FOR_DISTRIBUTION",
				versionString: "1.0",
			})
			.returning();
		await db.insert(versionLocalizations).values({
			appId: app.id,
			keywords: "todo,planner",
			language: "en-US",
			source: "remote",
			subtitle: "Plan your day",
			title: "Task Master",
			versionId: v1.id,
		});
		await db.insert(listings).values({
			appId: app.id,
			keywords: "stale",
			language: "en-US",
			source: "remote",
			title: "Old title",
		});
		const target = { externalId: "123456", id: app.id, platform: "ios" };

		// Act
		const live = await ListingVersionService.readTexts(target, "1.0");
		const past = await ListingVersionService.readTexts(target, "1.0", {
			versionKeywordsOnly: true,
		});
		const unsynced = await ListingVersionService.readTexts(target, "2.0");

		// Assert
		expect(live.get("en-US")).toEqual({
			keywords: "todo,planner",
			subtitle: "Plan your day",
			title: "Task Master",
		});
		expect(past.get("en-US")).toEqual({
			keywords: "todo,planner",
			subtitle: null,
			title: null,
		});
		// A version AppBoard has not synced yet falls back to the synced listing.
		expect(unsynced.get("en-US")?.title).toBe("Old title");
	});
});

describe("Workspace isolation", () => {
	it("workspace B cannot read workspace A's positions per version", async () => {
		const appId = await seedTrackedApp();
		const res = await server.handle(
			authRequestB(`${BASE}/apps/${appId}/tracking/by-version?country=us`),
		);
		expect(res.status).toBe(404);
	});

	it("workspace A cannot read workspace B's positions per version", async () => {
		const appB = await seedTestApp(storeIds[1]);
		const res = await server.handle(
			authRequest(`${BASE}/apps/${appB.id}/tracking/by-version`),
		);
		expect(res.status).toBe(404);
	});
});

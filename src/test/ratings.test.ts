import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { reviewsController } from "@/modules/reviews";
import {
	isRatingsRefreshDue,
	runRatingsTick,
} from "@/modules/reviews/ratings.scheduler";
import {
	RATINGS_RETRY_AFTER_MS,
	RatingsService,
	setRatingFetcher,
} from "@/modules/reviews/ratings.service";
import type {
	CountryRating,
	RatingStoreType,
} from "@/modules/reviews/ratings.types";
import { ReviewsService } from "@/modules/reviews/reviews.service";
import {
	configureRankLookup,
	STORE_THROTTLED_CODE,
} from "@/modules/tracking/rank-lookup";
import { AppStoreProvider } from "@/providers/app-store";
import { clearAscTokenCache } from "@/providers/app-store/asc-token";
import { encrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import {
	appGroupMembers,
	appGroups,
	appRatingRefreshes,
	appRatingSnapshots,
	apps,
	reviews,
	stores,
} from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { errorHandler } from "@/utils/errors/errorHandler";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
} from "./setup";

const TZ = "Europe/Warsaw";
// 05:00 in Warsaw: inside the refresh window.
const MORNING = new Date("2026-11-04T04:00:00Z");
const ASC_APP_ID = "6787068440";
const PLAY_PACKAGE = "tech.ravenlab.buzzin";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ASC_CREDENTIALS = {
	issuerId: "issuer-ratings",
	keyId: "key-ratings",
	privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
};

/** What the fake stores answer: only these storefronts have ratings. */
const RATINGS: Record<RatingStoreType, Record<string, [number, number]>> = {
	app_store: { de: [3.66667, 3], pl: [4.59259, 27], us: [5, 5] },
	google_play: { pl: [4.529412, 73] },
};

function fakeRating(
	storeType: RatingStoreType,
	country: string,
): CountryRating | null {
	const hit = RATINGS[storeType][country];
	if (!hit) {
		// The App Store answers resultCount 0, Play a page with no ratings.
		return storeType === "app_store"
			? null
			: {
					average: null,
					country,
					currentVersionAverage: null,
					currentVersionRatingCount: null,
					histogram: null,
					ratingCount: 0,
					version: "1.7.5",
					writtenReviews: null,
				};
	}
	return {
		average: hit[0],
		country,
		currentVersionAverage: hit[0],
		currentVersionRatingCount: hit[1],
		histogram:
			storeType === "google_play"
				? { "1": 5, "2": 3, "3": 0, "4": 3, "5": 62 }
				: null,
		ratingCount: hit[1],
		version: "1.7.5",
		writtenReviews: storeType === "google_play" ? 21 : null,
	};
}

const calls: { country: string; storeType: RatingStoreType }[] = [];
let throttleCountry: string | null = null;

/** App Store Connect, answered from memory. */
const ascRequests: { body?: string; method: string; url: string }[] = [];
const originalFetch = globalThis.fetch;

function ascReviewsPage() {
	return {
		data: [
			{
				attributes: {
					body: "Best party game on the TV",
					createdDate: "2026-11-01T10:00:00-07:00",
					rating: 5,
					reviewerNickname: "Ania",
					territory: "POL",
					title: "Super",
				},
				id: "asc-review-1",
				relationships: {
					response: {
						data: { id: "asc-response-1", type: "customerReviewResponses" },
					},
				},
				type: "customerReviews",
			},
			{
				attributes: {
					body: "Crashes on my iPad",
					createdDate: "2026-11-02T10:00:00-07:00",
					rating: 2,
					reviewerNickname: "Bob",
					territory: "USA",
					title: "Meh",
				},
				id: "asc-review-2",
				relationships: { response: { data: null } },
				type: "customerReviews",
			},
		],
		included: [
			{
				attributes: {
					lastModifiedDate: "2026-11-02T08:00:00Z",
					responseBody: "Dziekujemy!",
					state: "PUBLISHED",
				},
				id: "asc-response-1",
				type: "customerReviewResponses",
			},
		],
		links: { self: "https://api.appstoreconnect.apple.com/v1/x" },
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}

const app = new Elysia()
	.use(authGuard)
	.use(errorHandler)
	.group("/api", (a) => a.use(reviewsController));

const storeIds: string[] = [];
let iosAppId: string;
let androidAppId: string;
let loneAppId: string;
let groupId: string;

async function insertStore(values: {
	connectionMode?: string;
	credentials: string | null;
	type: string;
}) {
	const [store] = await db
		.insert(stores)
		.values({
			connectionMode: values.connectionMode ?? "api",
			credentials: values.credentials,
			name: `Ratings ${values.type}`,
			status: "connected",
			type: values.type,
			workspaceId: getTestWorkspaceId(),
		})
		.returning();
	storeIds.push(store.id);
	return store;
}

async function insertApp(
	storeId: string,
	values: { externalId: string; platform: string; status?: string },
) {
	const [row] = await db
		.insert(apps)
		.values({
			bundleId: "tech.ravenlab.buzzin",
			externalId: values.externalId,
			name: "Buzzin",
			platform: values.platform,
			status: values.status ?? "active",
			storeId,
		})
		.returning();
	return row.id;
}

beforeAll(async () => {
	configureRankLookup({
		sleep: async () => {},
		spacingMs: { appstore: 0, playstore: 0 },
	});
	setRatingFetcher(async (storeType, _externalId, country) => {
		calls.push({ country, storeType });
		if (country === throttleCountry) {
			buildError("storeUnavailable", {
				code: STORE_THROTTLED_CODE,
				info: "Store throttled: test",
			});
		}
		return fakeRating(storeType, country);
	});
	clearAscTokenCache();
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		if (!url.startsWith("https://api.appstoreconnect.apple.com/")) {
			throw new Error(`Unexpected network call in test: ${url}`);
		}
		const method = (init?.method ?? "GET").toUpperCase();
		ascRequests.push({
			body: typeof init?.body === "string" ? init.body : undefined,
			method,
			url,
		});
		if (
			method === "GET" &&
			url.includes(`/apps/${ASC_APP_ID}/customerReviews`)
		) {
			return jsonResponse(200, ascReviewsPage());
		}
		if (method === "POST" && url.endsWith("/v1/customerReviewResponses")) {
			return jsonResponse(201, {
				data: {
					attributes: {},
					id: "asc-response-2",
					type: "customerReviewResponses",
				},
			});
		}
		return jsonResponse(404, { errors: [{ status: "404" }] });
	}) as typeof fetch;

	const ascStore = await insertStore({
		credentials: encrypt(JSON.stringify(ASC_CREDENTIALS)),
		type: "app_store",
	});
	const playStore = await insertStore({
		credentials: encrypt(JSON.stringify({ mock: true })),
		type: "google_play",
	});
	iosAppId = await insertApp(ascStore.id, {
		externalId: ASC_APP_ID,
		platform: "ios",
	});
	androidAppId = await insertApp(playStore.id, {
		externalId: PLAY_PACKAGE,
		platform: "android",
	});
	const loneStore = await insertStore({
		connectionMode: "public",
		credentials: null,
		type: "google_play",
	});
	loneAppId = await insertApp(loneStore.id, {
		externalId: "com.playbuzzin.tv",
		platform: "android",
	});

	const [group] = await db
		.insert(appGroups)
		.values({
			name: `Buzzin ratings ${Date.now()}`,
			workspaceId: getTestWorkspaceId(),
		})
		.returning();
	groupId = group.id;
	await db.insert(appGroupMembers).values([
		{ appId: iosAppId, groupId, sortOrder: 0 },
		{ appId: androidAppId, groupId, sortOrder: 1 },
	]);
});

afterAll(async () => {
	globalThis.fetch = originalFetch;
	setRatingFetcher();
	configureRankLookup();
	await db.delete(appGroups).where(eq(appGroups.id, groupId));
	await cleanupStores(storeIds);
});

describe("App Store Connect customer reviews", () => {
	it("maps reviews, replies and the alpha-3 territory", async () => {
		const provider = new AppStoreProvider(ASC_CREDENTIALS);
		const fetched = await provider.fetchReviews(ASC_APP_ID);
		expect(fetched).toHaveLength(2);
		const [first, second] = fetched;
		expect(first.externalId).toBe("asc-review-1");
		expect(first.territory).toBe("pl");
		expect(first.language).toBeUndefined();
		expect(first.replyText).toBe("Dziekujemy!");
		expect(first.repliedAt?.toISOString()).toBe("2026-11-02T08:00:00.000Z");
		expect(second.territory).toBe("us");
		expect(second.replyText).toBeUndefined();

		const request = ascRequests.find((r) => r.url.includes("customerReviews"));
		expect(request?.url).toContain("include=response");
		expect(request?.url).toContain("limit=200");
	});

	it("syncs into the reviews table as App Store reviews", async () => {
		const result = await ReviewsService.syncFromStore(iosAppId);
		expect(result.synced).toBe(2);
		const rows = await db
			.select()
			.from(reviews)
			.where(eq(reviews.appId, iosAppId));
		expect(rows.map((r) => r.storeType)).toEqual(["app_store", "app_store"]);
		expect(rows.map((r) => r.territory).sort()).toEqual(["pl", "us"]);

		// Re-sync does not duplicate.
		await ReviewsService.syncFromStore(iosAppId);
		const again = await db
			.select()
			.from(reviews)
			.where(eq(reviews.appId, iosAppId));
		expect(again).toHaveLength(2);
	});

	it("replies through customerReviewResponses", async () => {
		const [row] = await db
			.select()
			.from(reviews)
			.where(eq(reviews.externalId, "asc-review-2"));
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${iosAppId}/reviews/${row.id}/reply`,
				{
					body: JSON.stringify({ text: "Thanks, a fix is on the way" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);
		expect(res.status).toBe(200);
		const post = ascRequests.find(
			(r) => r.method === "POST" && r.url.endsWith("/customerReviewResponses"),
		);
		const body = JSON.parse(post?.body ?? "{}");
		expect(body.data.type).toBe("customerReviewResponses");
		expect(body.data.attributes.responseBody).toBe(
			"Thanks, a fix is on the way",
		);
		expect(body.data.relationships.review.data).toEqual({
			id: "asc-review-2",
			type: "customerReviews",
		});
	});
});

describe("daily ratings refresh", () => {
	it("is due once per local day from 04:00, and resumes after back-off", () => {
		const day = "2026-11-04";
		// 03:59 Warsaw: not yet.
		expect(
			isRatingsRefreshDue(undefined, new Date("2026-11-04T02:59:00Z"), TZ),
		).toBe(false);
		expect(isRatingsRefreshDue(undefined, MORNING, TZ)).toBe(true);
		expect(
			isRatingsRefreshDue(
				{ completedAt: new Date(), day, nextAttemptAt: null },
				MORNING,
				TZ,
			),
		).toBe(false);
		// Yesterday's run, finished: due again today.
		expect(
			isRatingsRefreshDue(
				{ completedAt: new Date(), day: "2026-11-03", nextAttemptAt: null },
				MORNING,
				TZ,
			),
		).toBe(true);
		const later = new Date(MORNING.getTime() + RATINGS_RETRY_AFTER_MS);
		const paused = { completedAt: null, day, nextAttemptAt: later };
		expect(isRatingsRefreshDue(paused, MORNING, TZ)).toBe(false);
		expect(isRatingsRefreshDue(paused, later, TZ)).toBe(true);
	});

	it("first run checks every storefront and stores only rated ones", async () => {
		calls.length = 0;
		const outcome = await RatingsService.refreshApp(iosAppId, { now: MORNING });
		expect(outcome).toBe("completed");
		expect(calls.length).toBeGreaterThan(170);

		const snaps = await db
			.select()
			.from(appRatingSnapshots)
			.where(eq(appRatingSnapshots.appId, iosAppId));
		expect(snaps.map((s) => s.country).sort()).toEqual(["de", "pl", "us"]);
		const pl = snaps.find((s) => s.country === "pl");
		expect(pl?.ratingCount).toBe(27);
		expect(pl?.day).toBe("2026-11-04");
		// App Store has no count of reviews with text: ours, per country.
		expect(pl?.writtenReviews).toBe(1);

		const [state] = await db
			.select()
			.from(appRatingRefreshes)
			.where(eq(appRatingRefreshes.appId, iosAppId));
		expect(state.completedAt).not.toBeNull();
		expect(state.fullSweep).toBe(true);
		expect(state.lastFullSweepDay).toBe("2026-11-04");
		expect(state.reviewsSynced).toBe(true);
	});

	it("does not run twice a day; a forced run checks only the known countries", async () => {
		expect(await RatingsService.refreshApp(iosAppId, { now: MORNING })).toBe(
			"already_done",
		);
		calls.length = 0;
		expect(
			await RatingsService.refreshApp(iosAppId, { force: true, now: MORNING }),
		).toBe("completed");
		expect(calls.map((c) => c.country).sort()).toEqual(["de", "pl", "us"]);
	});

	it("syncs written reviews of an API connection once per day", async () => {
		const outcome = await RatingsService.refreshApp(androidAppId, {
			now: MORNING,
		});
		expect(outcome).toBe("completed");
		const synced = await db
			.select()
			.from(reviews)
			.where(eq(reviews.appId, androidAppId));
		// The mock Play provider serves 20 reviews.
		expect(synced).toHaveLength(20);
	});

	it("stops on a throttling store and resumes where it stopped", async () => {
		throttleCountry = "fr";
		calls.length = 0;
		const outcome = await RatingsService.refreshApp(loneAppId, {
			now: MORNING,
		});
		expect(outcome).toBe("throttled");

		const [paused] = await db
			.select()
			.from(appRatingRefreshes)
			.where(eq(appRatingRefreshes.appId, loneAppId));
		expect(paused.completedAt).toBeNull();
		expect(paused.nextAttemptAt?.getTime()).toBe(
			MORNING.getTime() + RATINGS_RETRY_AFTER_MS,
		);
		expect(paused.doneCountries).toContain("ae");
		expect(paused.doneCountries).not.toContain("fr");
		// A link-imported app has no store API to pull written reviews from.
		expect(paused.reviewsSynced).toBe(false);
		expect(isRatingsRefreshDue(paused, MORNING, TZ)).toBe(false);

		throttleCountry = null;
		calls.length = 0;
		const later = new Date(MORNING.getTime() + RATINGS_RETRY_AFTER_MS);
		const ran = await runRatingsTick(later, TZ, async () => [
			{ appId: loneAppId, storeType: "google_play" },
		]);
		expect(ran).toBe(1);
		expect(calls[0].country).toBe("fr");
		expect(calls.some((c) => c.country === "ae")).toBe(false);

		const [done] = await db
			.select()
			.from(appRatingRefreshes)
			.where(eq(appRatingRefreshes.appId, loneAppId));
		expect(done.completedAt).not.toBeNull();
		const snaps = await db
			.select()
			.from(appRatingSnapshots)
			.where(eq(appRatingSnapshots.appId, loneAppId));
		expect(snaps.map((s) => s.country)).toEqual(["pl"]);
	});

	it("lists live store apps only", async () => {
		const draftStore = await insertStore({
			connectionMode: "public",
			credentials: null,
			type: "app_store",
		});
		const draftId = await insertApp(draftStore.id, {
			externalId: "999",
			platform: "ios",
			status: "draft",
		});
		const listed = (await RatingsService.listRefreshableApps()).map(
			(a) => a.appId,
		);
		expect(listed).toContain(iosAppId);
		expect(listed).toContain(androidAppId);
		expect(listed).not.toContain(draftId);
	});
});

describe("GET /api/apps/:appId/reviews/ratings", () => {
	it("app scope shows one store with its countries", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${iosAppId}/reviews/ratings`),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.scope).toBe("app");
		expect(body.group).toBeNull();
		expect(body.stores).toHaveLength(1);
		const appStore = body.stores[0];
		expect(appStore.storeType).toBe("app_store");
		expect(appStore.ratingCount).toBe(35);
		expect(appStore.writtenReviews).toBe(2);
		expect(
			appStore.countries.map((c: { country: string }) => c.country),
		).toEqual(["pl", "us", "de"]);
		expect(body.total.ratingCount).toBe(35);
		expect(body.apps[0].lastRefreshedAt).not.toBeNull();
	});

	it("group scope sums the iPhone and Android records", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${androidAppId}/reviews/ratings?scope=group`,
			),
		);
		const body = await res.json();
		expect(body.scope).toBe("group");
		expect(body.group.id).toBe(groupId);
		expect(body.apps.map((a: { appId: string }) => a.appId).sort()).toEqual(
			[iosAppId, androidAppId].sort(),
		);
		const play = body.stores.find(
			(s: { storeType: string }) => s.storeType === "google_play",
		);
		expect(play.ratingCount).toBe(73);
		expect(play.writtenReviews).toBe(21);
		expect(play.syncedReviews).toBe(20);
		expect(play.histogram["5"]).toBe(62);
		expect(body.total.ratingCount).toBe(108);
		expect(body.total.writtenReviews).toBe(23);
		// (4.59259 x 27 + 5 x 5 + 3.66667 x 3 + 4.529412 x 73) / 108
		expect(body.total.average).toBe(4.543);
	});

	it("an app in no group falls back to itself for scope=group", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${loneAppId}/reviews/ratings?scope=group`,
			),
		);
		const body = await res.json();
		expect(body.scope).toBe("app");
		expect(body.apps).toHaveLength(1);
	});

	it("rejects an unknown scope", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${iosAppId}/reviews/ratings?scope=workspace`,
			),
		);
		expect(res.status).toBe(422);
	});

	it("is not reachable from another workspace", async () => {
		const res = await app.handle(
			authRequestB(`http://localhost/api/apps/${iosAppId}/reviews/ratings`),
		);
		expect(res.status).toBe(404);
		const refresh = await app.handle(
			authRequestB(
				`http://localhost/api/apps/${iosAppId}/reviews/ratings/refresh`,
				{ method: "POST" },
			),
		);
		expect(refresh.status).toBe(404);
	});

	it("needs authentication", async () => {
		const res = await app.handle(
			new Request(`http://localhost/api/apps/${iosAppId}/reviews/ratings`),
		);
		expect(res.status).toBe(401);
	});

	it("POST refresh runs every app of the group", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${iosAppId}/reviews/ratings/refresh?scope=group`,
				{ method: "POST" },
			),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.started.sort()).toEqual([iosAppId, androidAppId].sort());
	});
});

describe("GET /api/apps/:appId/reviews with scope and country", () => {
	it("group scope lists App Store and Google Play reviews together", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${androidAppId}/reviews?scope=group`,
			),
		);
		const body = await res.json();
		const storesSeen = new Set(
			body.reviews.map((r: { storeType: string }) => r.storeType),
		);
		expect([...storesSeen].sort()).toEqual(["app_store", "google_play"]);
		const asc = body.reviews.find(
			(r: { externalId: string }) => r.externalId === "asc-review-1",
		);
		expect(asc.appId).toBe(iosAppId);
		expect(asc.country).toBe("pl");
		expect(asc.canReply).toBe(true);
		expect(body.countries).toEqual(["de", "pl", "us"]);

		const appOnly = await app
			.handle(authRequest(`http://localhost/api/apps/${androidAppId}/reviews`))
			.then((r) => r.json());
		expect(
			appOnly.reviews.every(
				(r: { storeType: string }) => r.storeType === "google_play",
			),
		).toBe(true);
	});

	it("filters by store and by country, old alpha-3 rows included", async () => {
		// A row synced before territories were normalised.
		await db.insert(reviews).values({
			appId: iosAppId,
			authorName: "Old",
			body: "Synced before the fix",
			externalId: "asc-legacy",
			language: "USA",
			rating: 4,
			reviewDate: new Date("2026-10-01T00:00:00Z"),
			storeType: "app_store",
			territory: "USA",
		});
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${androidAppId}/reviews?scope=group&storeType=app_store&country=us`,
			),
		);
		const body = await res.json();
		expect(
			body.reviews.map((r: { externalId: string }) => r.externalId).sort(),
		).toEqual(["asc-legacy", "asc-review-2"]);
		expect(
			body.reviews.every((r: { country: string }) => r.country === "us"),
		).toBe(true);
	});

	it("stats cover the group with scope=group", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${iosAppId}/reviews/stats?scope=group`,
			),
		);
		const body = await res.json();
		expect(body.totalReviews).toBe(23);
	});

	it("does not leak another workspace's reviews", async () => {
		const res = await app.handle(
			authRequestB(`http://localhost/api/apps/${iosAppId}/reviews?scope=group`),
		);
		expect(res.status).toBe(404);
	});
});

afterAll(async () => {
	// Rows of the apps above go with the stores (cascade); make sure.
	const ids = [iosAppId, androidAppId, loneAppId].filter(Boolean);
	if (ids.length) {
		await db
			.delete(appRatingSnapshots)
			.where(inArray(appRatingSnapshots.appId, ids));
	}
});

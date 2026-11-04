import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { storePerformanceController } from "@/modules/store-performance";
import type { StorageResult } from "@/modules/store-performance/play-reports.storage";
import { StorePerformanceService } from "@/modules/store-performance/store-performance.service";
import { storesController } from "@/modules/stores";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
} from "@/test/setup";
import { encrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { apps, stores } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
import {
	BUZZIN_OCT_TRAFFIC,
	fixtureReport,
	TV_OCT_TRAFFIC,
	utf16Report,
} from "./play-report-fixtures";

const BUCKET = "pubsite_prod_5411382577729402537";
const SERVICE_ACCOUNT = "appboard-play@example-project.iam.gserviceaccount.com";
const STORAGE_HOST = "storage.googleapis.com";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) =>
		a.use(storesController).use(storePerformanceController),
	);

/** Fake bucket: object name -> bytes. Listing and downloads read from it. */
let bucketObjects = new Map<string, Uint8Array>();
/** Status the fake Cloud Storage answers every request with, 200 = serve the bucket. */
let storageStatus = 200;
let storageCalls: string[] = [];

const realFetch = globalThis.fetch;
const realAccessToken = StorePerformanceService.accessToken;
const realNow = StorePerformanceService.now;

function fakeStorage(url: URL): Response {
	storageCalls.push(url.pathname + url.search);
	if (storageStatus !== 200) {
		return new Response(JSON.stringify({ error: { message: "denied" } }), {
			status: storageStatus,
		});
	}
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
		const items = [...bucketObjects.keys()]
			.filter((name) => name.startsWith(prefix))
			.map((name) => ({ name }));
		return Response.json({ items });
	}
	return new Response("The specified bucket does not exist.", { status: 404 });
}

const storeIds: string[] = [];

async function seedPlayStore(
	options: {
		bucket?: string | null;
		connectionMode?: "api" | "public";
		credentials?: Record<string, unknown> | null;
		type?: string;
		workspaceId?: string;
	} = {},
) {
	const credentials =
		options.credentials === null
			? null
			: encrypt(
					JSON.stringify(
						options.credentials ?? {
							client_email: SERVICE_ACCOUNT,
							private_key:
								"-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
							project_id: "example-project",
						},
					),
				);
	const [store] = await db
		.insert(stores)
		.values({
			connectionMode: options.connectionMode ?? "api",
			credentials,
			name: "Play account",
			playReportsBucket: options.bucket ?? null,
			status: "connected",
			type: options.type ?? "google_play",
			workspaceId: options.workspaceId ?? getTestWorkspaceId(),
		})
		.returning();
	storeIds.push(store.id);
	return store;
}

async function seedApp(
	storeId: string,
	options: {
		devices?: Array<"phone" | "tablet" | "tv">;
		externalId?: string;
		platform?: string;
	} = {},
) {
	const [row] = await db
		.insert(apps)
		.values({
			bundleId: options.externalId ?? "tech.ravenlab.buzzin",
			devices: options.devices ?? ["phone"],
			externalId: options.externalId ?? "tech.ravenlab.buzzin",
			name: "Buzzin",
			platform: options.platform ?? "android",
			storeId,
		})
		.returning();
	return row;
}

async function getReport(appId: string, query = "", asB = false) {
	const url = `http://localhost/api/apps/${appId}/store-performance${query}`;
	const response = await app.handle(asB ? authRequestB(url) : authRequest(url));
	return { body: await response.json(), status: response.status };
}

beforeAll(() => {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (url.host === STORAGE_HOST) return fakeStorage(url);
		return realFetch(input, init);
	}) as typeof fetch;
	StorePerformanceService.accessToken = async (): Promise<
		StorageResult<string>
	> => ({
		ok: true,
		value: "test-token",
	});
	StorePerformanceService.now = () => new Date("2026-11-04T09:00:00Z");
});

afterAll(async () => {
	globalThis.fetch = realFetch;
	StorePerformanceService.accessToken = realAccessToken;
	StorePerformanceService.now = realNow;
	await cleanupStores(storeIds);
});

beforeEach(() => {
	StorePerformanceService.clearCache();
	storageStatus = 200;
	storageCalls = [];
	bucketObjects = new Map([
		[BUZZIN_OCT_TRAFFIC, fixtureReport(BUZZIN_OCT_TRAFFIC)],
		[TV_OCT_TRAFFIC, fixtureReport(TV_OCT_TRAFFIC)],
		[
			"stats/store_performance/store_performance_tech.ravenlab.buzzin_202610_country.csv",
			utf16Report(
				[
					"Date",
					"Package name",
					"Country / region",
					"Store listing acquisitions",
					"Store listing visitors",
					"Store listing conversion rate",
				],
				[
					["2026-10-03", "tech.ravenlab.buzzin", "PL", "200", "260", "0.77"],
					["2026-10-04", "tech.ravenlab.buzzin", "ES", "60", "75", "0.8"],
				],
			),
		],
		[
			"stats/installs/installs_tech.ravenlab.buzzin_202610_overview.csv",
			utf16Report(
				[
					"Date",
					"Package Name",
					"Daily Device Installs",
					"Daily Device Uninstalls",
					"Install events",
					"Update events",
					"Uninstall events",
				],
				[["2026-10-03", "tech.ravenlab.buzzin", "90", "12", "95", "40", "13"]],
			),
		],
		// Same prefix family, different file: must never be read as traffic.
		[
			"stats/store_performance/total_store_performance_tech.ravenlab.buzzin_202610_traffic_source.csv",
			utf16Report(
				["Date", "Traffic source", "Total store acquisitions"],
				[["2026-10-01", "Other", "999"]],
			),
		],
	]);
});

describe("GET /apps/:appId/store-performance", () => {
	it("answers supported: false for iOS apps", async () => {
		const store = await seedPlayStore({ type: "app_store" });
		const ios = await seedApp(store.id, {
			externalId: "6787068440",
			platform: "ios",
		});
		const { body, status } = await getReport(ios.id);
		expect(status).toBe(200);
		expect(body.supported).toBe(false);
		expect(body.message).toContain("App Store analytics");
		expect(storageCalls).toEqual([]);
	});

	it("asks for the bucket until one is saved", async () => {
		const store = await seedPlayStore();
		const android = await seedApp(store.id);
		const { body } = await getReport(android.id);
		expect(body.supported).toBe(true);
		expect(body.status).toBe("bucket_missing");
		expect(body.message).toContain("Copy Cloud Storage URI");
		expect(body.serviceAccountEmail).toBe(SERVICE_ACCOUNT);
		expect(storageCalls).toEqual([]);
	});

	it("reads one month per calendar month, newest first, with the real numbers", async () => {
		const store = await seedPlayStore({ bucket: BUCKET });
		const android = await seedApp(store.id);
		const { body, status } = await getReport(android.id, "?months=2");
		expect(status).toBe(200);
		expect(body.status).toBe("ok");
		expect(body.months.map((m: { month: string }) => m.month)).toEqual([
			"2026-11",
			"2026-10",
		]);

		const [november, october] = body.months;
		expect(november.traffic).toBeNull();
		expect(november.files).toEqual({
			country: false,
			installs: false,
			trafficSource: false,
		});

		expect(october.files).toEqual({
			country: true,
			installs: true,
			trafficSource: true,
		});
		expect(
			october.traffic.sources.map(
				(s: { acquisitions: number; source: string; visitors: number }) => [
					s.source,
					s.acquisitions,
					s.visitors,
				],
			),
		).toEqual([
			["Other", 1191, 1717],
			["Ads and referrals", 1100, 1322],
			["Google Play search", 509, 590],
		]);
		expect(
			october.traffic.searchTerms.map((t: { term: string }) => t.term),
		).toEqual(["buzzin"]);
		expect(october.countries[0]).toMatchObject({
			acquisitions: 200,
			country: "PL",
			visitors: 260,
		});
		expect(october.installs).toMatchObject({
			deviceInstalls: 90,
			deviceUninstalls: 12,
		});
		expect(october.lastDay).toBe("2026-10-24");
		expect(body.tvOnly).toBe(false);
		expect(body.fetchedAt).toBeString();
	});

	it("serves a repeat read from the cache and refresh=true reads the bucket again", async () => {
		const store = await seedPlayStore({ bucket: BUCKET });
		const android = await seedApp(store.id);
		await getReport(android.id, "?months=1");
		const firstCalls = storageCalls.length;
		expect(firstCalls).toBeGreaterThan(0);

		await getReport(android.id, "?months=1");
		expect(storageCalls.length).toBe(firstCalls);

		await getReport(android.id, "?months=1&refresh=true");
		expect(storageCalls.length).toBe(firstCalls * 2);
	});

	it("only downloads files the listing has (no 404 storm)", async () => {
		const store = await seedPlayStore({ bucket: BUCKET });
		const android = await seedApp(store.id);
		await getReport(android.id, "?months=3");
		const downloads = storageCalls.filter((call) => call.includes("alt=media"));
		expect(downloads.length).toBe(3);
		expect(
			downloads.some((call) => call.includes("total_store_performance")),
		).toBe(false);
	});

	it("explains a 403 from the bucket and how to grant bulk-report access, without caching it", async () => {
		const store = await seedPlayStore({ bucket: BUCKET });
		const android = await seedApp(store.id);
		storageStatus = 403;
		const denied = await getReport(android.id);
		expect(denied.status).toBe(200);
		expect(denied.body.status).toBe("access_denied");
		expect(denied.body.message).toContain(SERVICE_ACCOUNT);
		expect(denied.body.message).toContain(
			"View app information and download bulk reports",
		);
		expect(denied.body.months).toEqual([]);

		storageStatus = 200;
		const granted = await getReport(android.id);
		expect(granted.body.status).toBe("ok");
	});

	it("treats a 401 like a missing permission", async () => {
		const store = await seedPlayStore({ bucket: BUCKET });
		const android = await seedApp(store.id);
		storageStatus = 401;
		const { body } = await getReport(android.id);
		expect(body.status).toBe("access_denied");
	});

	it("says when the bucket does not exist", async () => {
		const store = await seedPlayStore({ bucket: "pubsite_prod_000" });
		const android = await seedApp(store.id);
		const { body } = await getReport(android.id);
		expect(body.status).toBe("bucket_not_found");
		expect(body.message).toContain("pubsite_prod_000");
	});

	it("reports a key Google refuses as credentials_invalid", async () => {
		const store = await seedPlayStore({ bucket: BUCKET });
		const android = await seedApp(store.id);
		StorePerformanceService.accessToken = async () => ({
			failure: {
				detail: "invalid_grant",
				kind: "credentials_invalid",
				status: null,
			},
			ok: false,
		});
		try {
			const { body } = await getReport(android.id);
			expect(body.status).toBe("credentials_invalid");
			expect(body.message).toContain("invalid_grant");
		} finally {
			StorePerformanceService.accessToken = async () => ({
				ok: true,
				value: "test-token",
			});
		}
	});

	it("needs an API connection for link-imported apps", async () => {
		const store = await seedPlayStore({
			bucket: BUCKET,
			connectionMode: "public",
			credentials: null,
		});
		const android = await seedApp(store.id);
		const { body } = await getReport(android.id);
		expect(body.status).toBe("integration_required");
		expect(storageCalls).toEqual([]);
	});

	it("flags Android TV packages", async () => {
		const store = await seedPlayStore({ bucket: BUCKET });
		const tv = await seedApp(store.id, {
			devices: ["tv"],
			externalId: "com.playbuzzin.tv",
		});
		const { body } = await getReport(tv.id, "?months=2");
		expect(body.tvOnly).toBe(true);
		expect(
			body.months[1].traffic.sources.map((s: { source: string }) => s.source),
		).toEqual(["Other"]);
		expect(body.months[1].traffic.searchTerms).toEqual([]);
	});

	it("rejects months outside 1..12", async () => {
		const store = await seedPlayStore({ bucket: BUCKET });
		const android = await seedApp(store.id);
		expect((await getReport(android.id, "?months=0")).status).toBe(422);
		expect((await getReport(android.id, "?months=13")).status).toBe(422);
	});

	it("returns 404 for an app of another workspace", async () => {
		const store = await seedPlayStore({ bucket: BUCKET });
		const android = await seedApp(store.id);
		const { status } = await getReport(android.id, "", true);
		expect(status).toBe(404);
		expect(storageCalls).toEqual([]);
	});
});

describe("PATCH /stores/:storeId/play-reports-bucket", () => {
	async function patchBucket(
		storeId: string,
		bucket: string | null,
		asB = false,
	) {
		const url = `http://localhost/api/stores/${storeId}/play-reports-bucket`;
		const init = {
			body: JSON.stringify({ bucket }),
			headers: { "Content-Type": "application/json" },
			method: "PATCH",
		};
		const response = await app.handle(
			asB ? authRequestB(url, init) : authRequest(url, init),
		);
		return { body: await response.json(), status: response.status };
	}

	it("normalizes the gs:// URI, shows it in the store list and clears with null", async () => {
		const store = await seedPlayStore();
		const saved = await patchBucket(store.id, `gs://${BUCKET}/stats/`);
		expect(saved.status).toBe(200);
		expect(saved.body.playReportsBucket).toBe(BUCKET);

		const list = await app
			.handle(authRequest("http://localhost/api/stores"))
			.then((r) => r.json());
		const listed = list.stores.find((s: { id: string }) => s.id === store.id);
		expect(listed.playReportsBucket).toBe(BUCKET);

		const cleared = await patchBucket(store.id, null);
		expect(cleared.body.playReportsBucket).toBeNull();
		const [row] = await db.select().from(stores).where(eq(stores.id, store.id));
		expect(row.playReportsBucket).toBeNull();
	});

	it("rejects text that is not a bucket", async () => {
		const store = await seedPlayStore();
		const { body, status } = await patchBucket(
			store.id,
			"https://play.google.com/console",
		);
		expect(status).toBe(400);
		expect(body.data.info).toContain("Copy Cloud Storage URI");
	});

	it("only applies to Google Play connections", async () => {
		const store = await seedPlayStore({ type: "app_store" });
		const { status } = await patchBucket(store.id, BUCKET);
		expect(status).toBe(400);
	});

	it("returns 404 for a store of another workspace and leaves it unchanged", async () => {
		const store = await seedPlayStore({ bucket: BUCKET });
		const { status } = await patchBucket(store.id, "pubsite_prod_999", true);
		expect(status).toBe(404);
		const [row] = await db.select().from(stores).where(eq(stores.id, store.id));
		expect(row.playReportsBucket).toBe(BUCKET);
	});

	it("drops the cached report of the store when the bucket changes", async () => {
		const store = await seedPlayStore({ bucket: BUCKET });
		const android = await seedApp(store.id);
		await getReport(android.id, "?months=1");
		const firstCalls = storageCalls.length;
		await patchBucket(store.id, BUCKET);
		await getReport(android.id, "?months=1");
		expect(storageCalls.length).toBe(firstCalls * 2);
	});
});

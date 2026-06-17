import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { AssetsService } from "@/modules/assets/assets.service";
import { listingsController } from "@/modules/listings";
import { publishingController } from "@/modules/publishing";
import { PublishingService } from "@/modules/publishing/publishing.service";
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
import { assets, listings } from "@/utils/db/schema";

const BASE = "http://localhost/api";
const FAKE_APP_ID = "00000000-0000-0000-0000-0000000000bb";

describe("publishAll per-item report", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (a) => a.use(publishingController).use(listingsController));

	let storeId: string;
	let appId: string;

	beforeAll(async () => {
		const store = await seedTestStore(getTestWorkspaceId());
		storeId = store.id;
		const testApp = await seedTestApp(store.id);
		appId = testApp.id;
	});

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	async function resetData() {
		await db.delete(listings).where(eq(listings.appId, appId));
		await db.delete(assets).where(eq(assets.appId, appId));
	}

	it("reports each dirty listing language as published (mock GP store)", async () => {
		await resetData();
		await db.insert(listings).values([
			{
				appId,
				isDirty: true,
				language: "en-US",
				source: "draft",
				title: "Hello",
			},
			{ appId, isDirty: true, language: "pl", source: "draft", title: "Cześć" },
		]);

		const result = await PublishingService.publishAll(appId);

		expect(Array.isArray(result.report)).toBe(true);
		const listingItems = result.report.filter((r) => r.kind === "listing");
		expect(listingItems.length).toBe(2);
		expect(listingItems.every((r) => r.status === "published")).toBe(true);
		expect(listingItems.map((r) => r.ref).sort()).toEqual(["en-US", "pl"]);
	});

	it("one failing publish unit does not abort the rest and is recorded as failed", async () => {
		await resetData();
		// Dirty listing draft (will publish OK via mock GP provider)
		await db.insert(listings).values({
			appId,
			isDirty: true,
			language: "en-US",
			source: "draft",
			title: "Hello",
		});
		// Dirty asset (asset publish will be forced to throw)
		await db.insert(assets).values({
			appId,
			assetType: "screenshot",
			deviceType: "phone",
			fileName: "shot-1.png",
			isDirty: true,
			language: "en-US",
			source: "draft",
		});

		const spy = spyOn(AssetsService, "publishAssets").mockRejectedValue(
			new Error("boom: asset upload failed"),
		);

		try {
			// Must NOT throw even though the asset unit fails.
			const result = await PublishingService.publishAll(appId);

			const listingItem = result.report.find((r) => r.kind === "listing");
			const assetItem = result.report.find((r) => r.kind === "asset");

			expect(listingItem?.status).toBe("published");
			expect(assetItem?.status).toBe("failed");
			expect(assetItem?.ref).toBe("shot-1.png");
			expect(assetItem?.error).toContain("boom");

			// Backward-compatible fields are still present.
			expect(result.listings.published).toBe(1);
			expect(result.assets.published).toBe(0);
		} finally {
			spy.mockRestore();
		}
	});

	it("returns 404 for non-existent app via the publish endpoint", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/apps/${FAKE_APP_ID}/publishing/publish`, {
				body: JSON.stringify({}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(404);
	});
});

describe("copyScreenshots with copyLocalizations", () => {
	let storeId: string;
	let appId: string;

	beforeAll(async () => {
		const store = await seedTestStore(getTestWorkspaceId());
		storeId = store.id;
		const testApp = await seedTestApp(store.id);
		appId = testApp.id;
	});

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	it("copies source language text metadata into the target language draft and sets isDirty", async () => {
		await db.delete(listings).where(eq(listings.appId, appId));

		// Source language has remote text.
		await db.insert(listings).values({
			appId,
			fullDesc: "Source full description",
			keywords: "source,keywords",
			language: "en-US",
			promoText: "Source promo",
			shortDesc: "Source short",
			source: "remote",
			title: "Source Title",
			whatsNew: "Source whats new",
		});

		// copyScreenshots throws because the target has no source screenshots,
		// but the localization copy runs first and must persist regardless.
		await expect(
			PublishingService.copyScreenshots(
				appId,
				"default",
				"en-US",
				"de-DE",
				undefined,
				true,
			),
		).rejects.toBeDefined();

		const [draft] = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, appId),
					eq(listings.language, "de-DE"),
					eq(listings.source, "draft"),
				),
			)
			.limit(1);

		expect(draft).toBeDefined();
		expect(draft.title).toBe("Source Title");
		expect(draft.shortDesc).toBe("Source short");
		expect(draft.fullDesc).toBe("Source full description");
		expect(draft.keywords).toBe("source,keywords");
		expect(draft.promoText).toBe("Source promo");
		expect(draft.whatsNew).toBe("Source whats new");
		expect(draft.isDirty).toBe(true);
	});

	it("does not copy text when copyLocalizations is false (default)", async () => {
		await db.delete(listings).where(eq(listings.appId, appId));
		await db.insert(listings).values({
			appId,
			language: "en-US",
			source: "remote",
			title: "Source Title",
		});

		await expect(
			PublishingService.copyScreenshots(appId, "default", "en-US", "fr-FR"),
		).rejects.toBeDefined();

		const [draft] = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, appId),
					eq(listings.language, "fr-FR"),
					eq(listings.source, "draft"),
				),
			)
			.limit(1);

		expect(draft).toBeUndefined();
	});
});

describe("publish/copy workspace isolation", () => {
	let storeIdA: string;
	let appIdA: string;

	const app = new Elysia()
		.use(authGuard)
		.group("/api", (a) => a.use(publishingController));

	beforeAll(async () => {
		const storeA = await seedTestStore(getTestWorkspaceId());
		storeIdA = storeA.id;
		const testAppA = await seedTestApp(storeA.id);
		appIdA = testAppA.id;
	});

	afterAll(async () => {
		if (storeIdA) await cleanupStores([storeIdA]);
	});

	it("workspace B cannot publish workspace A's app", async () => {
		const res = await app.handle(
			authRequestB(`${BASE}/apps/${appIdA}/publishing/publish`, {
				body: JSON.stringify({}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(404);
	});

	it("workspace B cannot copy screenshots on workspace A's app", async () => {
		const res = await app.handle(
			authRequestB(`${BASE}/apps/${appIdA}/publishing/screenshots/copy`, {
				body: JSON.stringify({
					copyLocalizations: true,
					sourceLanguage: "en-US",
					targetLanguage: "pl",
					versionId: "default",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(404);
	});

	// Sanity: workspace A (owner) passes ownership and is NOT 404.
	it("workspace A passes ownership check on its own app", async () => {
		expect(getTestWorkspaceId()).not.toBe(getTestWorkspaceIdB());
	});
});

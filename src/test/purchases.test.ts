import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { purchasesController } from "@/modules/purchases";
import { storesController } from "@/modules/stores";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
} from "./setup";

describe("Purchases module", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) =>
			app.use(storesController).use(purchasesController),
		);

	let storeIdGP: string;
	let storeIdAS: string;
	let appIdGP: string;
	let appIdAS: string;

	afterAll(async () => {
		const ids = [storeIdGP, storeIdAS].filter(Boolean) as string[];
		if (ids.length > 0) await cleanupStores(ids);
	});

	// ── Setup: connect stores and get app IDs ───────────────────────

	it("sets up Google Play store with mock apps", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/stores/connect", {
				body: JSON.stringify({
					credentials: { mock: true, type: "mock" },
					name: "Purchases Test GP",
					type: "google_play",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		const data = await res.json();
		storeIdGP = data.store.id;
		expect(data.syncedApps).toBeGreaterThan(0);
	});

	it("sets up App Store with mock apps", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/stores/connect", {
				body: JSON.stringify({
					credentials: { mock: true },
					name: "Purchases Test AS",
					type: "app_store",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		const data = await res.json();
		storeIdAS = data.store.id;
		expect(data.syncedApps).toBeGreaterThan(0);
	});

	it("finds app IDs for testing", async () => {
		// We need to use the apps endpoint to find app IDs
		// Since the apps controller is not mounted, query DB directly
		const { db } = await import("@/utils/db");
		const { apps, stores } = await import("@/utils/db/schema");
		const { eq } = await import("drizzle-orm");

		const gpApps = await db
			.select({ id: apps.id })
			.from(apps)
			.where(eq(apps.storeId, storeIdGP))
			.limit(1);

		const asApps = await db
			.select({ id: apps.id })
			.from(apps)
			.where(eq(apps.storeId, storeIdAS))
			.limit(1);

		appIdGP = gpApps[0].id;
		appIdAS = asApps[0].id;

		expect(appIdGP).toBeDefined();
		expect(appIdAS).toBeDefined();
	});

	// ── Sync purchases ──────────────────────────────────────────────

	it("syncs purchases for a Google Play app", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdGP}/purchases/sync`,
				{ method: "POST" },
			),
		);

		expect(res.status).toBe(200);

		const data = await res.json();
		expect(typeof data.syncedGroups).toBe("number");
		expect(typeof data.syncedIaps).toBe("number");
		expect(typeof data.syncedSubscriptions).toBe("number");
		expect(data.syncedGroups).toBeGreaterThanOrEqual(1);
		expect(data.syncedIaps).toBeGreaterThanOrEqual(1);
		expect(data.syncedSubscriptions).toBeGreaterThanOrEqual(1);
	});

	it("syncs purchases for an App Store app", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/purchases/sync`,
				{ method: "POST" },
			),
		);

		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.syncedGroups).toBeGreaterThanOrEqual(1);
		expect(data.syncedIaps).toBeGreaterThanOrEqual(1);
	});

	// ── List purchases ──────────────────────────────────────────────

	it("lists all purchases for a Google Play app", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdGP}/purchases`),
		);

		expect(res.status).toBe(200);

		const data = await res.json();
		expect(Array.isArray(data.purchases)).toBe(true);
		expect(data.purchases.length).toBeGreaterThanOrEqual(3);

		// Verify purchase structure
		const purchase = data.purchases[0];
		expect(purchase.id).toBeDefined();
		expect(purchase.name).toBeDefined();
		expect(purchase.productId).toBeDefined();
		expect(purchase.productType).toBeDefined();
		expect(purchase.status).toBeDefined();
		expect(Array.isArray(purchase.localizations)).toBe(true);
		expect(Array.isArray(purchase.prices)).toBe(true);
	});

	it("lists all purchases for an App Store app", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdAS}/purchases`),
		);

		expect(res.status).toBe(200);

		const data = await res.json();
		expect(Array.isArray(data.purchases)).toBe(true);
		expect(data.purchases.length).toBeGreaterThanOrEqual(3);
	});

	// ── Get purchase detail ─────────────────────────────────────────

	it("returns purchase detail with localizations and prices", async () => {
		const listRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdGP}/purchases`),
		);
		const listData = await listRes.json();
		const purchaseId = listData.purchases[0].id;

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdGP}/purchases/${purchaseId}`,
			),
		);

		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.purchase).toBeDefined();
		expect(data.purchase.id).toBe(purchaseId);
		expect(data.purchase.name).toBeDefined();
		expect(data.purchase.productId).toBeDefined();
		expect(Array.isArray(data.purchase.localizations)).toBe(true);
		expect(Array.isArray(data.purchase.prices)).toBe(true);
	});

	it("returns 404 for non-existent purchase", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdGP}/purchases/00000000-0000-0000-0000-000000000000`,
			),
		);

		expect(res.status).toBe(404);
	});

	// ── Subscription groups ─────────────────────────────────────────

	it("lists subscription groups with subscriptions", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdGP}/subscription-groups`,
			),
		);

		expect(res.status).toBe(200);

		const data = await res.json();
		expect(Array.isArray(data.groups)).toBe(true);
		expect(data.groups.length).toBeGreaterThanOrEqual(1);

		const group = data.groups[0];
		expect(group.id).toBeDefined();
		expect(group.name).toBeDefined();
		expect(group.externalId).toBeDefined();
		expect(Array.isArray(group.subscriptions)).toBe(true);
		expect(group.subscriptions.length).toBeGreaterThanOrEqual(1);

		// Verify subscription structure within group
		const sub = group.subscriptions[0];
		expect(sub.productType).toBe("auto_renewable");
		expect(sub.name).toBeDefined();
		expect(Array.isArray(sub.localizations)).toBe(true);
		expect(Array.isArray(sub.prices)).toBe(true);
	});

	it("gets a specific subscription group", async () => {
		const listRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdGP}/subscription-groups`,
			),
		);
		const listData = await listRes.json();
		const groupId = listData.groups[0].id;

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdGP}/subscription-groups/${groupId}`,
			),
		);

		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.group).toBeDefined();
		expect(data.group.id).toBe(groupId);
		expect(Array.isArray(data.group.subscriptions)).toBe(true);
	});

	it("returns 404 for non-existent subscription group", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdGP}/subscription-groups/00000000-0000-0000-0000-000000000000`,
			),
		);

		expect(res.status).toBe(404);
	});

	// ── Re-sync (idempotency) ───────────────────────────────────────

	it("re-syncing purchases is idempotent", async () => {
		// Sync again
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdGP}/purchases/sync`,
				{ method: "POST" },
			),
		);

		expect(res.status).toBe(200);

		// Verify counts haven't doubled
		const listRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdGP}/purchases`),
		);
		const listData = await listRes.json();

		// Should still be the same number of purchases (upsert logic)
		// Mock data returns 3 IAPs + 2 subscriptions = 5 total
		expect(listData.purchases.length).toBe(5);
	});

	// ── Purchase localizations ──────────────────────────────────────

	it("purchases have localizations synced", async () => {
		const listRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdGP}/purchases`),
		);
		const listData = await listRes.json();

		// Find a purchase with localizations (IAPs should have them)
		const purchaseWithLocs = listData.purchases.find(
			(p: { localizations: unknown[] }) => p.localizations.length > 0,
		);

		expect(purchaseWithLocs).toBeDefined();
		expect(purchaseWithLocs.localizations.length).toBeGreaterThanOrEqual(1);

		const loc = purchaseWithLocs.localizations[0];
		expect(loc.language).toBeDefined();
		expect(loc.name).toBeDefined();
	});

	it("purchases have prices synced", async () => {
		const listRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdGP}/purchases`),
		);
		const listData = await listRes.json();

		const purchaseWithPrices = listData.purchases.find(
			(p: { prices: unknown[] }) => p.prices.length > 0,
		);

		expect(purchaseWithPrices).toBeDefined();
		expect(purchaseWithPrices.prices.length).toBeGreaterThanOrEqual(1);

		const price = purchaseWithPrices.prices[0];
		expect(price.currency).toBeDefined();
		expect(price.price).toBeDefined();
		expect(price.territory).toBeDefined();
	});

	// ── Workspace isolation ─────────────────────────────────────────

	it("workspace B cannot sync purchases for workspace A app", async () => {
		const res = await app.handle(
			authRequestB(
				`http://localhost/api/apps/${appIdGP}/purchases/sync`,
				{ method: "POST" },
			),
		);

		expect(res.status).toBe(404);
	});

	it("workspace B cannot list purchases for workspace A app", async () => {
		const res = await app.handle(
			authRequestB(`http://localhost/api/apps/${appIdGP}/purchases`),
		);

		expect(res.status).toBe(404);
	});

	it("workspace B cannot view subscription groups for workspace A app", async () => {
		const res = await app.handle(
			authRequestB(
				`http://localhost/api/apps/${appIdGP}/subscription-groups`,
			),
		);

		expect(res.status).toBe(404);
	});

	// ── Empty state ─────────────────────────────────────────────────

	it("returns empty purchases for app with no synced purchases", async () => {
		// Use workspace B which has no stores/purchases synced
		const connectRes = await app.handle(
			authRequestB("http://localhost/api/stores/connect", {
				body: JSON.stringify({
					credentials: { mock: true, type: "mock" },
					name: "Empty Purchases Test B",
					type: "google_play",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		const connectData = await connectRes.json();
		const emptyStoreId = connectData.store.id;

		// Get an app from this store
		const { db } = await import("@/utils/db");
		const { apps } = await import("@/utils/db/schema");
		const { eq } = await import("drizzle-orm");
		const emptyApps = await db
			.select({ id: apps.id })
			.from(apps)
			.where(eq(apps.storeId, emptyStoreId))
			.limit(1);
		const emptyAppId = emptyApps[0].id;

		// This app exists but has no purchases synced
		const res = await app.handle(
			authRequestB(`http://localhost/api/apps/${emptyAppId}/purchases`),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.purchases).toEqual([]);

		// Cleanup
		await cleanupStores([emptyStoreId]);
	});
});

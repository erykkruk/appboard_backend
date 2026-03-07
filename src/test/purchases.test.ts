import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { purchasesController } from "@/modules/purchases";
import { storesController } from "@/modules/stores";
import { authGuard, authRequest, authRequestB, cleanupStores } from "./setup";

describe("Purchases module", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(storesController).use(purchasesController));

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
		const { apps } = await import("@/utils/db/schema");
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
			authRequest(`http://localhost/api/apps/${appIdGP}/purchases/sync`, {
				method: "POST",
			}),
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
			authRequest(`http://localhost/api/apps/${appIdAS}/purchases/sync`, {
				method: "POST",
			}),
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
			authRequest(`http://localhost/api/apps/${appIdGP}/subscription-groups`),
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
			authRequest(`http://localhost/api/apps/${appIdGP}/subscription-groups`),
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
			authRequest(`http://localhost/api/apps/${appIdGP}/purchases/sync`, {
				method: "POST",
			}),
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
			authRequestB(`http://localhost/api/apps/${appIdGP}/purchases/sync`, {
				method: "POST",
			}),
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
			authRequestB(`http://localhost/api/apps/${appIdGP}/subscription-groups`),
		);

		expect(res.status).toBe(404);
	});

	// ── CRUD: Create IAP ────────────────────────────────────────────

	it("creates an in-app purchase (GP mock)", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdGP}/purchases`, {
				body: JSON.stringify({
					localizations: [
						{
							description: "1000 gems pack",
							language: "en-US",
							name: "1000 Gems",
						},
					],
					name: "1000 Gems",
					prices: [{ currency: "USD", price: "1.99", territory: "US" }],
					productId: "test.gems.1000",
					productType: "consumable",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.purchase).toBeDefined();
		expect(data.purchase.productId).toBe("test.gems.1000");
		expect(data.purchase.name).toBe("1000 Gems");
		expect(data.purchase.productType).toBe("consumable");
	});

	it("creates an in-app purchase (AS mock)", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdAS}/purchases`, {
				body: JSON.stringify({
					name: "Premium Icons",
					productId: "test.icons.premium",
					productType: "non_consumable",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.purchase.productId).toBe("test.icons.premium");
		expect(data.purchase.productType).toBe("non_consumable");
	});

	it("created IAP appears in list", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdGP}/purchases`),
		);
		const data = await res.json();

		const created = data.purchases.find(
			(p: { productId: string }) => p.productId === "test.gems.1000",
		);
		expect(created).toBeDefined();
		expect(created.name).toBe("1000 Gems");
	});

	// ── CRUD: Update IAP ────────────────────────────────────────────

	it("updates an in-app purchase name and localizations", async () => {
		const listRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdGP}/purchases`),
		);
		const listData = await listRes.json();
		const target = listData.purchases.find(
			(p: { productId: string }) => p.productId === "test.gems.1000",
		);

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdGP}/purchases/${target.id}`,
				{
					body: JSON.stringify({
						localizations: [
							{
								description: "1000 shiny gems",
								language: "en-US",
								name: "1000 Shiny Gems",
							},
						],
						name: "1000 Shiny Gems",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PATCH",
				},
			),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.purchase.name).toBe("1000 Shiny Gems");
	});

	// ── CRUD: Delete IAP ────────────────────────────────────────────

	it("deletes an in-app purchase", async () => {
		const listRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdGP}/purchases`),
		);
		const listData = await listRes.json();
		const target = listData.purchases.find(
			(p: { productId: string }) => p.productId === "test.gems.1000",
		);

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdGP}/purchases/${target.id}`,
				{ method: "DELETE" },
			),
		);

		expect(res.status).toBe(200);

		// Verify it's gone
		const checkRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdGP}/purchases/${target.id}`,
			),
		);
		expect(checkRes.status).toBe(404);
	});

	// ── CRUD: Subscription group ────────────────────────────────────

	it("creates a subscription group", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdGP}/subscription-groups`, {
				body: JSON.stringify({ name: "Pro Plans" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.group).toBeDefined();
		expect(data.group.name).toBe("Pro Plans");
		expect(data.group.id).toBeDefined();
		expect(Array.isArray(data.group.subscriptions)).toBe(true);
	});

	// ── CRUD: Subscription in group ─────────────────────────────────

	it("creates a subscription in a group", async () => {
		const groupsRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdGP}/subscription-groups`),
		);
		const groupsData = await groupsRes.json();
		const proGroup = groupsData.groups.find(
			(g: { name: string }) => g.name === "Pro Plans",
		);

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdGP}/subscription-groups/${proGroup.id}/subscriptions`,
				{
					body: JSON.stringify({
						duration: "P1M",
						localizations: [
							{
								description: "Monthly pro access",
								language: "en-US",
								name: "Pro Monthly",
							},
						],
						name: "Pro Monthly",
						prices: [{ currency: "USD", price: "9.99", territory: "US" }],
						productId: "test.pro.monthly",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.purchase).toBeDefined();
		expect(data.purchase.productId).toBe("test.pro.monthly");
		expect(data.purchase.productType).toBe("auto_renewable");
		expect(data.purchase.groupId).toBe(proGroup.id);
	});

	// ── CRUD: Workspace isolation ───────────────────────────────────

	it("workspace B cannot create purchase for workspace A app", async () => {
		const res = await app.handle(
			authRequestB(`http://localhost/api/apps/${appIdGP}/purchases`, {
				body: JSON.stringify({
					name: "Hacked Gems",
					productId: "hack.gems",
					productType: "consumable",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(404);
	});

	it("workspace B cannot delete purchase from workspace A", async () => {
		const listRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdGP}/purchases`),
		);
		const listData = await listRes.json();
		const purchaseId = listData.purchases[0].id;

		const res = await app.handle(
			authRequestB(
				`http://localhost/api/apps/${appIdGP}/purchases/${purchaseId}`,
				{ method: "DELETE" },
			),
		);

		expect(res.status).toBe(404);
	});

	// ═══════════════════════════════════════════════════════════════
	// ── Full integration: IAP consumable (AS mock) ─────────────
	// ═══════════════════════════════════════════════════════════════

	it("IAP consumable: create with localizations + prices → verify → update → delete (AS)", async () => {
		// Create
		const createRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdAS}/purchases`, {
				body: JSON.stringify({
					localizations: [
						{
							description: "100 gold coins",
							language: "en-US",
							name: "100 Coins",
						},
						{
							description: "100 złotych monet",
							language: "pl-PL",
							name: "100 Monet",
						},
					],
					name: "100 Coins",
					prices: [
						{ currency: "USD", price: "0.99", territory: "US" },
						{ currency: "PLN", price: "4.99", territory: "PL" },
					],
					productId: "inttest.coins.100",
					productType: "consumable",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(createRes.status).toBe(200);
		const created = (await createRes.json()).purchase;
		expect(created.productId).toBe("inttest.coins.100");
		expect(created.productType).toBe("consumable");
		expect(created.name).toBe("100 Coins");

		// Verify detail
		const detailRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/purchases/${created.id}`,
			),
		);
		expect(detailRes.status).toBe(200);
		const detail = (await detailRes.json()).purchase;
		expect(detail.localizations.length).toBeGreaterThanOrEqual(2);
		expect(detail.prices.length).toBeGreaterThanOrEqual(2);

		// Update name + localizations
		const updateRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/purchases/${created.id}`,
				{
					body: JSON.stringify({
						localizations: [
							{
								description: "200 gold coins",
								language: "en-US",
								name: "200 Coins",
							},
						],
						name: "200 Coins",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PATCH",
				},
			),
		);
		expect(updateRes.status).toBe(200);
		const updated = (await updateRes.json()).purchase;
		expect(updated.name).toBe("200 Coins");

		// Delete
		const deleteRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/purchases/${created.id}`,
				{
					method: "DELETE",
				},
			),
		);
		expect(deleteRes.status).toBe(200);

		// Verify gone
		const goneRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/purchases/${created.id}`,
			),
		);
		expect(goneRes.status).toBe(404);
	});

	// ═══════════════════════════════════════════════════════════════
	// ── Full integration: IAP non_consumable (AS mock) ─────────
	// ═══════════════════════════════════════════════════════════════

	it("IAP non_consumable: create → verify → delete (AS)", async () => {
		const createRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdAS}/purchases`, {
				body: JSON.stringify({
					localizations: [
						{
							description: "Remove all ads forever",
							language: "en-US",
							name: "Remove Ads",
						},
					],
					name: "Remove Ads",
					prices: [{ currency: "USD", price: "2.99", territory: "US" }],
					productId: "inttest.remove_ads",
					productType: "non_consumable",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(createRes.status).toBe(200);
		const created = (await createRes.json()).purchase;
		expect(created.productType).toBe("non_consumable");
		expect(created.productId).toBe("inttest.remove_ads");

		// Delete
		const deleteRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/purchases/${created.id}`,
				{
					method: "DELETE",
				},
			),
		);
		expect(deleteRes.status).toBe(200);

		// Verify gone
		const goneRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/purchases/${created.id}`,
			),
		);
		expect(goneRes.status).toBe(404);
	});

	// ═══════════════════════════════════════════════════════════════
	// ── Full integration: Subscription group lifecycle (AS mock)
	// ═══════════════════════════════════════════════════════════════

	it("subscription group: create → rename → verify rename (AS)", async () => {
		// Create group
		const createRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdAS}/subscription-groups`, {
				body: JSON.stringify({ name: "Original Premium" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(createRes.status).toBe(200);
		const group = (await createRes.json()).group;
		expect(group.name).toBe("Original Premium");

		// Rename
		const renameRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/subscription-groups/${group.id}`,
				{
					body: JSON.stringify({ name: "Renamed Premium" }),
					headers: { "Content-Type": "application/json" },
					method: "PATCH",
				},
			),
		);
		expect(renameRes.status).toBe(200);
		const renamed = (await renameRes.json()).group;
		expect(renamed.name).toBe("Renamed Premium");

		// Verify via GET
		const getRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/subscription-groups/${group.id}`,
			),
		);
		expect(getRes.status).toBe(200);
		const fetched = (await getRes.json()).group;
		expect(fetched.name).toBe("Renamed Premium");
	});

	// ═══════════════════════════════════════════════════════════════
	// ── Full integration: All subscription durations (AS mock) ──
	// ═══════════════════════════════════════════════════════════════

	it("subscriptions: create all durations → verify in group → update → delete all (AS)", async () => {
		// Create dedicated group
		const groupRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdAS}/subscription-groups`, {
				body: JSON.stringify({ name: "All Durations" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		const groupId = (await groupRes.json()).group.id;

		const durations = [
			{ duration: "P1W", label: "weekly" },
			{ duration: "P1M", label: "monthly" },
			{ duration: "P2M", label: "bimonthly" },
			{ duration: "P3M", label: "quarterly" },
			{ duration: "P6M", label: "semi_annual" },
			{ duration: "P1Y", label: "annual" },
		];

		const createdSubs: Array<{ duration: string; id: string; label: string }> =
			[];

		// Create each duration variant with localizations + prices
		for (const { duration, label } of durations) {
			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appIdAS}/subscription-groups/${groupId}/subscriptions`,
					{
						body: JSON.stringify({
							duration,
							localizations: [
								{
									description: `${label} subscription`,
									language: "en-US",
									name: `Pro ${label}`,
								},
								{
									description: `Subskrypcja ${label}`,
									language: "pl-PL",
									name: `Pro ${label}`,
								},
							],
							name: `Pro ${label}`,
							prices: [
								{ currency: "USD", price: "9.99", territory: "US" },
								{ currency: "PLN", price: "39.99", territory: "PL" },
							],
							productId: `inttest.pro.${label}`,
						}),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					},
				),
			);

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.purchase.productId).toBe(`inttest.pro.${label}`);
			expect(data.purchase.duration).toBe(duration);
			expect(data.purchase.productType).toBe("auto_renewable");
			expect(data.purchase.groupId).toBe(groupId);
			createdSubs.push({ duration, id: data.purchase.id, label });
		}

		// Verify all 6 subscriptions in group
		const verifyRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/subscription-groups/${groupId}`,
			),
		);
		const groupData = (await verifyRes.json()).group;
		expect(groupData.subscriptions.length).toBe(6);

		// Verify each subscription has localizations + prices
		for (const sub of groupData.subscriptions) {
			expect(sub.localizations.length).toBeGreaterThanOrEqual(2);
			expect(sub.prices.length).toBeGreaterThanOrEqual(2);
		}

		// Update one subscription (name + localization)
		const firstSub = createdSubs[0];
		const updateRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/purchases/${firstSub.id}`,
				{
					body: JSON.stringify({
						localizations: [
							{
								description: "Updated weekly sub",
								language: "en-US",
								name: "Pro Weekly Updated",
							},
						],
						name: "Pro Weekly Updated",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PATCH",
				},
			),
		);
		expect(updateRes.status).toBe(200);
		expect((await updateRes.json()).purchase.name).toBe("Pro Weekly Updated");

		// Delete all subscriptions
		for (const sub of createdSubs) {
			const delRes = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appIdAS}/purchases/${sub.id}`,
					{
						method: "DELETE",
					},
				),
			);
			expect(delRes.status).toBe(200);
		}

		// Verify group is empty
		const emptyRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/subscription-groups/${groupId}`,
			),
		);
		expect((await emptyRes.json()).group.subscriptions.length).toBe(0);

		// Verify individual subs are gone (404)
		for (const sub of createdSubs) {
			const goneRes = await app.handle(
				authRequest(`http://localhost/api/apps/${appIdAS}/purchases/${sub.id}`),
			);
			expect(goneRes.status).toBe(404);
		}
	});

	// ═══════════════════════════════════════════════════════════════
	// ── Full integration: Add subs to existing group (AS mock) ──
	// ═══════════════════════════════════════════════════════════════

	it("adds subscriptions to a synced existing group → delete (AS)", async () => {
		// Get groups from sync (should have "Premium" group from mock data)
		const groupsRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appIdAS}/subscription-groups`),
		);
		const groups = (await groupsRes.json()).groups;
		const syncedGroup = groups.find(
			(g: { name: string }) => g.name === "Premium",
		);

		// If no synced group, skip gracefully (depends on mock data)
		if (!syncedGroup) return;

		const existingSubCount = syncedGroup.subscriptions.length;

		// Add a new subscription to the existing synced group
		const addRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/subscription-groups/${syncedGroup.id}/subscriptions`,
				{
					body: JSON.stringify({
						duration: "P3M",
						name: "Premium Quarterly",
						productId: "inttest.premium.quarterly",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);
		expect(addRes.status).toBe(200);
		const added = (await addRes.json()).purchase;
		expect(added.groupId).toBe(syncedGroup.id);

		// Verify group now has one more subscription
		const afterRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/subscription-groups/${syncedGroup.id}`,
			),
		);
		const afterGroup = (await afterRes.json()).group;
		expect(afterGroup.subscriptions.length).toBe(existingSubCount + 1);

		// Clean up: delete the added subscription
		const delRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/purchases/${added.id}`,
				{
					method: "DELETE",
				},
			),
		);
		expect(delRes.status).toBe(200);

		// Verify count is back to original
		const cleanRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appIdAS}/subscription-groups/${syncedGroup.id}`,
			),
		);
		expect((await cleanRes.json()).group.subscriptions.length).toBe(
			existingSubCount,
		);
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

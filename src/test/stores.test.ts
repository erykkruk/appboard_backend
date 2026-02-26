import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { storesController } from "@/modules/stores";
import { authGuard, authRequest, authRequestB, cleanupStores } from "./setup";

describe("Stores module", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(storesController));
	let storeIdGP: string;
	let storeIdAS: string;

	afterAll(async () => {
		const ids = [storeIdGP, storeIdAS].filter(Boolean) as string[];
		if (ids.length > 0) await cleanupStores(ids);
	});

	// ── Google Play connect ─────────────────────────────────────────

	it("connects a Google Play store with mock credentials", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/stores/connect", {
				body: JSON.stringify({
					credentials: { mock: true, type: "mock" },
					name: "Test Google Play",
					type: "google_play",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);

		const data = await res.json();

		expect(data.store).toBeDefined();
		expect(data.store.name).toBe("Test Google Play");
		expect(data.store.status).toBe("connected");
		expect(data.store.type).toBe("google_play");

		expect(typeof data.syncedApps).toBe("number");
		expect(data.syncedApps).toBeGreaterThanOrEqual(0);

		expect(Array.isArray(data.warnings)).toBe(true);
		expect(data.warnings.length).toBeGreaterThanOrEqual(1);
		expect(
			data.warnings.some((w: string) => w.toLowerCase().includes("draft")),
		).toBe(true);

		storeIdGP = data.store.id;
	});

	// ── App Store connect ───────────────────────────────────────────

	it("connects an App Store with mock credentials", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/stores/connect", {
				body: JSON.stringify({
					credentials: { mock: true },
					name: "Test App Store",
					type: "app_store",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);

		const data = await res.json();

		expect(data.store).toBeDefined();
		expect(data.store.type).toBe("app_store");
		expect(data.store.status).toBe("connected");

		expect(typeof data.syncedApps).toBe("number");
		expect(data.syncedApps).toBeGreaterThanOrEqual(0);

		// App Store should not produce GP-specific warnings
		expect(Array.isArray(data.warnings)).toBe(true);
		expect(data.warnings.length).toBe(0);

		storeIdAS = data.store.id;
	});

	// ── Warning structure ───────────────────────────────────────────

	it("returns warnings as an array of strings for GP connect", async () => {
		// storeIdGP was created above; re-connect a fresh store to verify shape
		const res = await app.handle(
			authRequest("http://localhost/api/stores/connect", {
				body: JSON.stringify({
					credentials: { mock: true, type: "mock" },
					name: "Warning Shape Test",
					type: "google_play",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		const data = await res.json();
		const extraId = data.store?.id;

		expect(Array.isArray(data.warnings)).toBe(true);
		for (const w of data.warnings) {
			expect(typeof w).toBe("string");
		}

		// Cleanup the extra store immediately
		if (extraId) await cleanupStores([extraId]);
	});

	// ── List stores ─────────────────────────────────────────────────

	it("lists connected stores", async () => {
		const res = await app.handle(authRequest("http://localhost/api/stores"));

		expect(res.status).toBe(200);

		const data = await res.json();

		expect(Array.isArray(data.stores)).toBe(true);
		expect(data.stores.length).toBeGreaterThanOrEqual(2);

		const gpStore = data.stores.find((s: { id: string }) => s.id === storeIdGP);
		expect(gpStore).toBeDefined();
		expect(gpStore.name).toBe("Test Google Play");

		const asStore = data.stores.find((s: { id: string }) => s.id === storeIdAS);
		expect(asStore).toBeDefined();
		expect(asStore.name).toBe("Test App Store");
	});

	// ── Sync apps ───────────────────────────────────────────────────

	it("syncs apps from a Google Play store", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/stores/${storeIdGP}/sync`, {
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);

		const data = await res.json();
		expect(typeof data.synced).toBe("number");
		expect(data.synced).toBeGreaterThanOrEqual(0);
	});

	it("syncs apps from an App Store", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/stores/${storeIdAS}/sync`, {
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);

		const data = await res.json();
		expect(typeof data.synced).toBe("number");
		expect(data.synced).toBeGreaterThanOrEqual(0);
	});

	// ── Sync all ───────────────────────────────────────────────────

	it("syncs all connected stores at once", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/stores/sync-all", {
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);

		const data = await res.json();

		expect(typeof data.totalSynced).toBe("number");
		expect(data.totalSynced).toBeGreaterThanOrEqual(0);
		expect(Array.isArray(data.results)).toBe(true);
		expect(data.results.length).toBe(2);

		for (const result of data.results) {
			expect(typeof result.storeId).toBe("string");
			expect(typeof result.storeName).toBe("string");
			expect(typeof result.synced).toBe("number");
		}
	});

	it("sync-all returns empty results when workspace has no stores", async () => {
		const res = await app.handle(
			authRequestB("http://localhost/api/stores/sync-all", {
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);

		const data = await res.json();

		expect(data.totalSynced).toBe(0);
		expect(data.results).toEqual([]);
	});

	// ── Workspace isolation ─────────────────────────────────────────

	it("workspace B cannot see workspace A stores", async () => {
		const res = await app.handle(authRequestB("http://localhost/api/stores"));

		expect(res.status).toBe(200);

		const data = await res.json();

		expect(Array.isArray(data.stores)).toBe(true);

		const gpStore = data.stores.find((s: { id: string }) => s.id === storeIdGP);
		const asStore = data.stores.find((s: { id: string }) => s.id === storeIdAS);

		expect(gpStore).toBeUndefined();
		expect(asStore).toBeUndefined();
	});

	it("workspace B cannot sync workspace A store", async () => {
		const res = await app.handle(
			authRequestB(`http://localhost/api/stores/${storeIdGP}/sync`, {
				method: "POST",
			}),
		);

		// verifyStoreOwnership throws 404 when store not found in workspace
		expect(res.status).toBe(404);
	});

	it("workspace B cannot disconnect workspace A store", async () => {
		const res = await app.handle(
			authRequestB(`http://localhost/api/stores/${storeIdGP}`, {
				method: "DELETE",
			}),
		);

		// Should be 403 or 404 depending on implementation
		expect([403, 404]).toContain(res.status);
	});

	// ── Disconnect ──────────────────────────────────────────────────

	it("disconnects a Google Play store", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/stores/${storeIdGP}`, {
				method: "DELETE",
			}),
		);

		const data = await res.json();
		expect(data.success).toBe(true);
		storeIdGP = ""; // Prevent double-delete in afterAll
	});

	it("disconnects an App Store", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/stores/${storeIdAS}`, {
				method: "DELETE",
			}),
		);

		const data = await res.json();
		expect(data.success).toBe(true);
		storeIdAS = ""; // Prevent double-delete in afterAll
	});

	it("returns 404 for non-existent store disconnect", async () => {
		const res = await app.handle(
			authRequest(
				"http://localhost/api/stores/00000000-0000-0000-0000-000000000000",
				{ method: "DELETE" },
			),
		);

		expect(res.status).toBe(404);
	});
});

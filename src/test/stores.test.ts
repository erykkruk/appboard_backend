import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { storesController } from "@/modules/stores";
import { authGuard, authRequest, cleanupStores } from "./setup";

describe("Stores module", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(storesController));
	let createdStoreId: string;

	afterAll(async () => {
		if (createdStoreId) await cleanupStores([createdStoreId]);
	});

	it("POST /api/stores/connect creates a mock store", async () => {
		const response = await app
			.handle(
				authRequest("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Test Google Play",
						type: "google_play",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		expect(response.store).toBeDefined();
		expect(response.store.name).toBe("Test Google Play");
		expect(response.store.status).toBe("connected");
		expect(response.store.type).toBe("google_play");
		createdStoreId = response.store.id;
	});

	it("GET /api/stores lists connected stores", async () => {
		const response = await app
			.handle(authRequest("http://localhost/api/stores"))
			.then((res) => res.json());

		expect(response.stores).toBeArray();
		expect(response.stores.length).toBeGreaterThanOrEqual(1);
		const store = response.stores.find(
			(s: { id: string }) => s.id === createdStoreId,
		);
		expect(store).toBeDefined();
		expect(store.name).toBe("Test Google Play");
	});

	it("POST /api/stores/:storeId/sync syncs apps from store", async () => {
		const response = await app
			.handle(
				authRequest(`http://localhost/api/stores/${createdStoreId}/sync`, {
					method: "POST",
				}),
			)
			.then((res) => res.json());

		expect(response.synced).toBe(3); // 3 mock Android apps
	});

	it("DELETE /api/stores/:storeId disconnects a store", async () => {
		const response = await app
			.handle(
				authRequest(`http://localhost/api/stores/${createdStoreId}`, {
					method: "DELETE",
				}),
			)
			.then((res) => res.json());

		expect(response.success).toBe(true);
		// Store already deleted by the test, prevent double-delete in afterAll
		createdStoreId = "";
	});

	it("DELETE /api/stores/:storeId returns 404 for non-existent store", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/stores/00000000-0000-0000-0000-000000000000`,
				{ method: "DELETE" },
			),
		);

		expect(res.status).toBe(404);
	});
});

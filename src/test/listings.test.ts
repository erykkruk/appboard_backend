import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { historyController } from "@/modules/history";
import { listingsController } from "@/modules/listings";
import { storesController } from "@/modules/stores";
import { cleanupStores } from "./setup";

describe("Listings module", () => {
	const app = new Elysia().group("/api", (app) =>
		app
			.use(storesController)
			.use(appsController)
			.use(listingsController)
			.use(historyController),
	);

	let storeId: string;
	let appId: string;

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	it("sets up mock store and gets app ID", async () => {
		const storeRes = await app
			.handle(
				new Request("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Test GP Listings",
						type: "google_play",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		storeId = storeRes.store.id;

		const appsRes = await app
			.handle(new Request("http://localhost/api/apps"))
			.then((res) => res.json());

		// Find the mock TaskMaster app
		const mockApp = appsRes.apps.find(
			(a: { bundleId: string }) => a.bundleId === "com.example.taskmaster",
		);
		appId = mockApp.id;
	});

	it("POST /api/apps/:appId/listings/sync syncs listings from store", async () => {
		const response = await app
			.handle(
				new Request(`http://localhost/api/apps/${appId}/listings/sync`, {
					method: "POST",
				}),
			)
			.then((res) => res.json());

		expect(response.synced).toBe(3); // 3 languages
	});

	it("GET /api/apps/:appId/listings returns all listings", async () => {
		const response = await app
			.handle(new Request(`http://localhost/api/apps/${appId}/listings`))
			.then((res) => res.json());

		expect(response.listings).toBeArray();
		expect(response.listings.length).toBeGreaterThanOrEqual(3);
	});

	it("GET /api/apps/:appId/listings/:language returns listing for language", async () => {
		const response = await app
			.handle(new Request(`http://localhost/api/apps/${appId}/listings/en-US`))
			.then((res) => res.json());

		expect(response.remote).toBeDefined();
		expect(response.remote.language).toBe("en-US");
	});

	it("PUT /api/apps/:appId/listings/:language updates draft and sets isDirty", async () => {
		const response = await app
			.handle(
				new Request(`http://localhost/api/apps/${appId}/listings/en-US`, {
					body: JSON.stringify({
						shortDesc: "Updated description",
						title: "Updated Title",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		expect(response.listing).toBeDefined();
		expect(response.listing.isDirty).toBe(true);
		expect(response.listing.title).toBe("Updated Title");
		expect(response.listing.source).toBe("draft");
	});

	it("POST /api/apps/:appId/listings/publish publishes dirty drafts and creates history", async () => {
		const response = await app
			.handle(
				new Request(`http://localhost/api/apps/${appId}/listings/publish`, {
					method: "POST",
				}),
			)
			.then((res) => res.json());

		expect(response.published).toBe(1);
	});

	it("GET /api/apps/:appId/history returns change history", async () => {
		const response = await app
			.handle(new Request(`http://localhost/api/apps/${appId}/history`))
			.then((res) => res.json());

		expect(response.history).toBeArray();
		expect(response.history.length).toBeGreaterThanOrEqual(1);
	});
});

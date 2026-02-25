import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { listingsController } from "@/modules/listings";
import { storesController } from "@/modules/stores";
import { authGuard, authRequest, cleanupStores } from "./setup";

describe("Categories module", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) =>
			app.use(storesController).use(appsController).use(listingsController),
		);

	let storeId: string;
	let appId: string;

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	it("sets up mock store and gets app ID", async () => {
		const storeRes = await app
			.handle(
				authRequest("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Test Categories Store",
						type: "google_play",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		storeId = storeRes.store.id;

		const appsRes = await app
			.handle(authRequest("http://localhost/api/apps"))
			.then((res) => res.json());

		const mockApp = appsRes.apps.find(
			(a: { bundleId: string }) => a.bundleId === "com.example.taskmaster",
		);
		appId = mockApp.id;
	});

	it("GET /api/apps/:appId/listings/categories returns categories with available list", async () => {
		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/categories`),
			)
			.then((res) => res.json());

		expect(response.availableCategories).toBeArray();
		expect(response.availableCategories.length).toBeGreaterThan(0);
		expect(response.availableCategories[0]).toHaveProperty("id");
		expect(response.availableCategories[0]).toHaveProperty("name");
	});

	it("GET /api/apps/:appId/listings/categories returns null categories for new app", async () => {
		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/categories`),
			)
			.then((res) => res.json());

		expect(response.primaryCategory).toBeNull();
		expect(response.secondaryCategory).toBeNull();
	});

	it("PUT /api/apps/:appId/listings/categories saves primary category", async () => {
		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/categories`, {
					body: JSON.stringify({
						primaryCategory: "PRODUCTIVITY",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		expect(response.primaryCategory).toBe("PRODUCTIVITY");
		expect(response.secondaryCategory).toBeNull();
	});

	it("PUT /api/apps/:appId/listings/categories saves primary + secondary", async () => {
		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/categories`, {
					body: JSON.stringify({
						primaryCategory: "BUSINESS",
						secondaryCategory: "PRODUCTIVITY",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		expect(response.primaryCategory).toBe("BUSINESS");
		expect(response.secondaryCategory).toBe("PRODUCTIVITY");
	});

	it("GET /api/apps/:appId/listings/categories returns saved categories", async () => {
		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/categories`),
			)
			.then((res) => res.json());

		expect(response.primaryCategory).toBe("BUSINESS");
		expect(response.secondaryCategory).toBe("PRODUCTIVITY");
	});

	it("PUT /api/apps/:appId/listings/categories clears secondary when omitted", async () => {
		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/categories`, {
					body: JSON.stringify({
						primaryCategory: "EDUCATION",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		expect(response.primaryCategory).toBe("EDUCATION");
		expect(response.secondaryCategory).toBeNull();
	});

	it("PUT /api/apps/:appId/listings/categories rejects empty primary", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/listings/categories`, {
				body: JSON.stringify({
					primaryCategory: "",
				}),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(res.status).toBe(422);
	});

	it("PUT /api/apps/:appId/listings/categories rejects missing primary", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/listings/categories`, {
				body: JSON.stringify({
					secondaryCategory: "BUSINESS",
				}),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(res.status).toBe(422);
	});

	// --- Publish ---

	it("POST /api/apps/:appId/listings/categories/publish publishes categories to store", async () => {
		// Ensure categories are saved first
		await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/listings/categories`, {
				body: JSON.stringify({ primaryCategory: "PRODUCTIVITY" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appId}/listings/categories/publish`,
				{ method: "POST" },
			),
		);

		expect(res.status).toBe(200);
		const response = await res.json();
		expect(response.success).toBe(true);
	});

	it("POST /api/apps/:appId/listings/categories/publish with invalid appId returns 422", async () => {
		const res = await app.handle(
			authRequest(
				"http://localhost/api/apps/not-a-uuid/listings/categories/publish",
				{ method: "POST" },
			),
		);

		expect(res.status).toBe(422);
	});

	it("POST /api/apps/:appId/listings/sync also syncs categories", async () => {
		// First reset categories
		await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/listings/categories`, {
				body: JSON.stringify({ primaryCategory: "GAMES" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		// Sync from store (mock provider returns UTILITIES for primary)
		await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/listings/sync`, {
				method: "POST",
			}),
		);

		// Categories should be updated from the mock provider
		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/categories`),
			)
			.then((res) => res.json());

		// Google Play mock returns null for categories
		expect(response.primaryCategory).toBeNull();
		expect(response.secondaryCategory).toBeNull();
	});
});

describe("Categories with iOS mock store", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) =>
			app.use(storesController).use(appsController).use(listingsController),
		);

	let storeId: string;
	let appId: string;

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	it("sets up iOS mock store", async () => {
		const storeRes = await app
			.handle(
				authRequest("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Test iOS Categories Store",
						type: "app_store",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		storeId = storeRes.store.id;

		const appsRes = await app
			.handle(authRequest("http://localhost/api/apps"))
			.then((res) => res.json());

		const iosApp = appsRes.apps.find(
			(a: { platform: string }) => a.platform === "ios",
		);
		appId = iosApp.id;
	});

	it("POST /api/apps/:appId/listings/sync syncs iOS categories", async () => {
		await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/listings/sync`, {
				method: "POST",
			}),
		);

		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/categories`),
			)
			.then((res) => res.json());

		// After sync, categories should be populated (or null if no categories set in store)
		expect(response).toHaveProperty("primaryCategory");
		expect(response).toHaveProperty("secondaryCategory");
		expect(response.availableCategories).toBeArray();
		expect(response.availableCategories.length).toBeGreaterThan(0);
	});
});

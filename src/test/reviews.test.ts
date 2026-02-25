import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { reviewsController } from "@/modules/reviews";
import { storesController } from "@/modules/stores";
import { authGuard, authRequest, cleanupStores } from "./setup";

describe("Reviews module", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) =>
			app.use(storesController).use(appsController).use(reviewsController),
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
						name: "Test GP Reviews",
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

		// Find the mock TaskMaster app
		const mockApp = appsRes.apps.find(
			(a: { bundleId: string }) => a.bundleId === "com.example.taskmaster",
		);
		appId = mockApp.id;
	});

	it("POST /api/apps/:appId/reviews/sync syncs reviews from store", async () => {
		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/reviews/sync`, {
					method: "POST",
				}),
			)
			.then((res) => res.json());

		expect(response.synced).toBe(20);
	});

	it("GET /api/apps/:appId/reviews lists reviews", async () => {
		const response = await app
			.handle(authRequest(`http://localhost/api/apps/${appId}/reviews`))
			.then((res) => res.json());

		expect(response.reviews).toBeArray();
		expect(response.reviews.length).toBe(20);
	});

	it("GET /api/apps/:appId/reviews/stats returns statistics", async () => {
		const response = await app
			.handle(authRequest(`http://localhost/api/apps/${appId}/reviews/stats`))
			.then((res) => res.json());

		expect(response.totalReviews).toBe(20);
		expect(response.averageRating).toBeGreaterThan(0);
		expect(response.noReplyCount).toBeGreaterThanOrEqual(0);
		expect(response.distribution).toBeDefined();
		expect(response.distribution[1]).toBeGreaterThanOrEqual(0);
		expect(response.distribution[5]).toBeGreaterThanOrEqual(0);
	});

	it("POST /api/apps/:appId/reviews/:reviewId/reply replies to a review", async () => {
		const listRes = await app
			.handle(authRequest(`http://localhost/api/apps/${appId}/reviews`))
			.then((res) => res.json());

		const reviewId = listRes.reviews[0].id;
		const response = await app
			.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/reviews/${reviewId}/reply`,
					{
						body: JSON.stringify({ text: "Thank you for your review!" }),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					},
				),
			)
			.then((res) => res.json());

		expect(response.success).toBe(true);
	});
});

import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { publishingController } from "@/modules/publishing";
import { authGuard, authRequest, authRequestB } from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { errorHandler } from "@/utils/errors/errorHandler";

describe("GET /api/apps/:appId/publishing/push-preview", () => {
	const app = new Elysia()
		.use(authGuard)
		.use(errorHandler)
		.group("/api", (app) => app.use(publishingController));

	const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

	it("returns 422 for invalid appId", async () => {
		const res = await app.handle(
			authRequest(
				"http://localhost/api/apps/not-a-uuid/publishing/push-preview",
			),
		);
		expect(res.status).toBe(422);
	});

	it("returns 404 for non-existent app", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${FAKE_UUID}/publishing/push-preview`,
			),
		);
		expect(res.status).toBe(404);
	});

	it("returns push preview with correct structure for Google Play app", async () => {
		const store = await seedTestStore();
		const testApp = await seedTestApp(store.id);

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${testApp.id}/publishing/push-preview`,
			),
		);

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data).toHaveProperty("isIos");
		expect(data).toHaveProperty("listings");
		expect(data).toHaveProperty("assets");
		expect(data).toHaveProperty("ageRating");
		expect(data).toHaveProperty("privacy");
		expect(data).toHaveProperty("categories");
		expect(data.isIos).toBe(false);
		expect(data.listings).toHaveProperty("count");
		expect(data.listings).toHaveProperty("changes");
		expect(data.assets).toHaveProperty("count");
		expect(data.ageRating).toHaveProperty("configured");
		expect(data.privacy).toHaveProperty("configured");
		expect(data.purchases).toHaveProperty("purchaseCount");
		expect(data.purchases).toHaveProperty("groupCount");
		expect(data.purchases).toHaveProperty("localizationCount");
		expect(data.purchases).toHaveProperty("priceCount");
	});

	it("returns ageRating.configured=false when no age rating exists", async () => {
		const store = await seedTestStore();
		const testApp = await seedTestApp(store.id);

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${testApp.id}/publishing/push-preview`,
			),
		);

		const data = await res.json();
		expect(data.ageRating.configured).toBe(false);
	});

	it("returns privacy.configured=false when no privacy declaration exists", async () => {
		const store = await seedTestStore();
		const testApp = await seedTestApp(store.id);

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${testApp.id}/publishing/push-preview`,
			),
		);

		const data = await res.json();
		expect(data.privacy.configured).toBe(false);
	});

	it("blocks cross-workspace access", async () => {
		const store = await seedTestStore();
		const testApp = await seedTestApp(store.id);

		const res = await app.handle(
			authRequestB(
				`http://localhost/api/apps/${testApp.id}/publishing/push-preview`,
			),
		);

		// verifyAppOwnership returns 404 to avoid leaking resource existence
		expect([403, 404]).toContain(res.status);
	});
});

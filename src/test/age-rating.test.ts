import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import {
	ageRatingController,
	ageRatingPresetsController,
} from "@/modules/age-rating";
import { appsController } from "@/modules/apps";
import { storesController } from "@/modules/stores";
import { db } from "@/utils/db";
import { appAgeRatings } from "@/utils/db/schema";
import { authGuard, authRequest, cleanupStores } from "./setup";

describe("Age Rating module", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) =>
			app
				.use(storesController)
				.use(appsController)
				.use(ageRatingPresetsController)
				.use(ageRatingController),
		);

	let storeId: string;
	let appId: string;

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	beforeAll(async () => {
		await db.delete(appAgeRatings);
	});

	it("sets up mock store with apps", async () => {
		const response = await app
			.handle(
				authRequest("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Test Age Rating Store",
						type: "google_play",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		storeId = response.store.id;

		const appsRes = await app
			.handle(authRequest("http://localhost/api/apps"))
			.then((res) => res.json());

		appId = appsRes.apps[0].id;
	});

	it("GET /api/age-rating-presets returns all presets", async () => {
		const response = await app
			.handle(authRequest("http://localhost/api/age-rating-presets"))
			.then((res) => res.json());

		expect(response.presets).toBeArray();
		expect(response.presets.length).toBe(5);

		const ids = response.presets.map((p: { id: string }) => p.id);
		expect(ids).toContain("everyone");
		expect(ids).toContain("teen");
		expect(ids).toContain("mature");
		expect(ids).toContain("custom");
	});

	it("GET /api/apps/:appId/age-rating returns null when none exists", async () => {
		const response = await app
			.handle(authRequest(`http://localhost/api/apps/${appId}/age-rating`))
			.then((res) => res.json());

		expect(response.ageRating).toBeNull();
	});

	it("PUT with preset 'everyone' creates rating", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/age-rating`, {
				body: JSON.stringify({ presetId: "everyone" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(res.status).toBe(200);

		const response = await res.json();
		const rating = response.ageRating;
		expect(rating).toBeDefined();
		expect(rating.presetId).toBe("everyone");
		expect(rating.appleRating).toBe("4+");
		expect(rating.googleRating).toBe("EVERYONE");
		expect(rating.appId).toBe(appId);
	});

	it("PUT with preset 'teen' updates rating", async () => {
		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/age-rating`, {
					body: JSON.stringify({ presetId: "teen" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		const rating = response.ageRating;
		expect(rating.presetId).toBe("teen");
		expect(rating.appleRating).toBe("12+");
		expect(rating.googleRating).toBe("TEEN");
	});

	it("PUT with preset 'mature' sets correct ratings", async () => {
		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/age-rating`, {
					body: JSON.stringify({ presetId: "mature" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		const rating = response.ageRating;
		expect(rating.presetId).toBe("mature");
		expect(rating.appleRating).toBe("17+");
		expect(rating.googleRating).toBe("MATURE");
		expect(rating.appleQuestionnaire.REALISTIC_VIOLENCE).toBe(
			"FREQUENT_INTENSE",
		);
	});

	it("PUT with preset 'custom' uses body questionnaire and computes rating", async () => {
		const questionnaire = {
			ALCOHOL_TOBACCO_DRUG_USE: "NONE",
			CARTOON_FANTASY_VIOLENCE: "FREQUENT_INTENSE",
			GAMBLING_CONTESTS: "NONE",
			GRAPHIC_SEXUAL_CONTENT_NUDITY: "NONE",
			HORROR_FEAR_THEMES: "INFREQUENT_MILD",
			MATURE_SUGGESTIVE: "NONE",
			MEDICAL_TREATMENT_INFO: "NONE",
			PROFANITY_CRUDE_HUMOR: "INFREQUENT_MILD",
			PROLONGED_GRAPHIC_SADISTIC_REALISTIC_VIOLENCE: "NONE",
			REALISTIC_VIOLENCE: "NONE",
			SEXUAL_CONTENT_NUDITY: "NONE",
			SIMULATED_GAMBLING: "NONE",
			UNRESTRICTED_WEB_ACCESS: "NONE",
		};

		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/age-rating`, {
					body: JSON.stringify({
						appleQuestionnaire: questionnaire,
						presetId: "custom",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		const rating = response.ageRating;
		expect(rating.presetId).toBe("custom");
		expect(rating.appleQuestionnaire).toEqual(questionnaire);
		// score = 2 (FREQUENT_INTENSE) + 1 + 1 (INFREQUENT_MILD x2) = 4 → 12+
		expect(rating.appleRating).toBe("12+");
	});

	it("GET returns saved rating", async () => {
		const response = await app
			.handle(authRequest(`http://localhost/api/apps/${appId}/age-rating`))
			.then((res) => res.json());

		expect(response.ageRating).not.toBeNull();
		expect(response.ageRating.presetId).toBe("custom");
	});

	it("GET with invalid appId returns 422", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/apps/not-a-uuid/age-rating"),
		);
		expect(res.status).toBe(422);
	});

	it("PUT with invalid appId returns 422", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/apps/not-a-uuid/age-rating", {
				body: JSON.stringify({ presetId: "everyone" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);
		expect(res.status).toBe(422);
	});

	// --- Publish ---

	it("POST /api/apps/:appId/age-rating/publish publishes saved rating to store", async () => {
		// Ensure a rating is saved first
		await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/age-rating`, {
				body: JSON.stringify({ presetId: "everyone" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/age-rating/publish`, {
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const response = await res.json();
		expect(response.success).toBe(true);
	});

	it("POST /api/apps/:appId/age-rating/publish returns 404 when no rating saved", async () => {
		// Use a non-existent but valid UUID
		const fakeAppId = "00000000-0000-0000-0000-000000000000";
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${fakeAppId}/age-rating/publish`,
				{ method: "POST" },
			),
		);

		expect(res.status).toBe(404);
	});

	it("POST with invalid appId returns 422", async () => {
		const res = await app.handle(
			authRequest(
				"http://localhost/api/apps/not-a-uuid/age-rating/publish",
				{ method: "POST" },
			),
		);
		expect(res.status).toBe(422);
	});
});

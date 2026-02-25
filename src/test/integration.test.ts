import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { ageRatingController } from "@/modules/age-rating";
import { appsController } from "@/modules/apps";
import { listingsController } from "@/modules/listings";
import {
	privacyDeclarationController,
	privacyTemplatesController,
} from "@/modules/privacy-declaration";
import { publishingController } from "@/modules/publishing";
import { settingsController } from "@/modules/settings";
import { storesController } from "@/modules/stores";
import { authGuard, authRequest, cleanupStores } from "./setup";

/**
 * Integration tests — full end-to-end flows that test multiple modules
 * working together, mimicking real user scenarios.
 */
describe("Integration: connect → sync → configure → publish", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) =>
			app
				.use(storesController)
				.use(appsController)
				.use(listingsController)
				.use(settingsController)
				.use(ageRatingController)
				.use(privacyTemplatesController)
				.use(privacyDeclarationController)
				.use(publishingController),
		);

	let storeId: string;
	let appId: string;

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	// ── Phase 1: Connect and sync ───────────────────────────────────

	it("connect store and auto-sync apps", async () => {
		const res = await app
			.handle(
				authRequest("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Integration Store",
						type: "google_play",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((r) => r.json());

		storeId = res.store.id;
		expect(res.store.status).toBe("connected");

		// Connect auto-syncs apps
		const appsRes = await app
			.handle(authRequest("http://localhost/api/apps"))
			.then((r) => r.json());

		expect(appsRes.apps.length).toBeGreaterThanOrEqual(3);
		appId = appsRes.apps[0].id;
	});

	it("store shows lastSyncedAt after connect", async () => {
		const res = await app
			.handle(authRequest("http://localhost/api/stores"))
			.then((r) => r.json());

		const store = res.stores.find((s: { id: string }) => s.id === storeId);
		expect(store.lastSyncedAt).toBeDefined();
	});

	it("manual sync updates lastSyncedAt", async () => {
		const beforeRes = await app
			.handle(authRequest("http://localhost/api/stores"))
			.then((r) => r.json());
		const beforeSync = beforeRes.stores.find(
			(s: { id: string }) => s.id === storeId,
		);

		// Wait a bit to ensure timestamp difference
		await new Promise((resolve) => setTimeout(resolve, 50));

		await app.handle(
			authRequest(`http://localhost/api/stores/${storeId}/sync`, {
				method: "POST",
			}),
		);

		const afterRes = await app
			.handle(authRequest("http://localhost/api/stores"))
			.then((r) => r.json());
		const afterSync = afterRes.stores.find(
			(s: { id: string }) => s.id === storeId,
		);

		expect(new Date(afterSync.lastSyncedAt).getTime()).toBeGreaterThanOrEqual(
			new Date(beforeSync.lastSyncedAt).getTime(),
		);
	});

	// ── Phase 2: Configure app metadata ─────────────────────────────

	it("save age rating locally (no store push)", async () => {
		const res = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/age-rating`, {
					body: JSON.stringify({ presetId: "teen" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((r) => r.json());

		expect(res.ageRating.presetId).toBe("teen");
		expect(res.ageRating.appleRating).toBe("12+");
		expect(res.ageRating.googleRating).toBe("TEEN");
	});

	it("save privacy declaration locally", async () => {
		const res = await app
			.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/privacy-declaration`,
					{
						body: JSON.stringify({
							privacyPolicyUrl: "https://example.com/privacy",
							templateId: "no_data_collected",
							trackingEnabled: false,
						}),
						headers: { "Content-Type": "application/json" },
						method: "PUT",
					},
				),
			)
			.then((r) => r.json());

		expect(res.privacyDeclaration.templateId).toBe("no_data_collected");
		expect(res.privacyDeclaration.privacyPolicyUrl).toBe(
			"https://example.com/privacy",
		);
	});

	it("save categories locally", async () => {
		const res = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/categories`, {
					body: JSON.stringify({
						primaryCategory: "PRODUCTIVITY",
						secondaryCategory: "BUSINESS",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((r) => r.json());

		expect(res.primaryCategory).toBe("PRODUCTIVITY");
		expect(res.secondaryCategory).toBe("BUSINESS");
	});

	it("verify saved data persists via GET", async () => {
		// Age rating
		const ageRes = await app
			.handle(authRequest(`http://localhost/api/apps/${appId}/age-rating`))
			.then((r) => r.json());
		expect(ageRes.ageRating.presetId).toBe("teen");

		// Privacy declaration
		const privRes = await app
			.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/privacy-declaration`,
				),
			)
			.then((r) => r.json());
		expect(privRes.privacyDeclaration.templateId).toBe("no_data_collected");

		// Categories
		const catRes = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/categories`),
			)
			.then((r) => r.json());
		expect(catRes.primaryCategory).toBe("PRODUCTIVITY");
	});

	// ── Phase 3: Publish to store ───────────────────────────────────

	it("publish age rating to store", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/age-rating/publish`, {
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
	});

	it("publish privacy declaration to store", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appId}/privacy-declaration/publish`,
				{ method: "POST" },
			),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
	});

	it("publish categories to store", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appId}/listings/categories/publish`,
				{ method: "POST" },
			),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
	});

	// ── Phase 4: Update and re-publish ──────────────────────────────

	it("update age rating and re-publish", async () => {
		// Update locally
		const updateRes = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/age-rating`, {
					body: JSON.stringify({ presetId: "mature" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((r) => r.json());

		expect(updateRes.ageRating.presetId).toBe("mature");
		expect(updateRes.ageRating.appleRating).toBe("17+");

		// Publish updated
		const pubRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/age-rating/publish`, {
				method: "POST",
			}),
		);
		expect(pubRes.status).toBe(200);
	});

	// ── Phase 5: Disconnect and verify cleanup ──────────────────────

	it("disconnect store removes it and its apps", async () => {
		const delRes = await app
			.handle(
				authRequest(`http://localhost/api/stores/${storeId}`, {
					method: "DELETE",
				}),
			)
			.then((r) => r.json());

		expect(delRes.success).toBe(true);

		// Store no longer listed
		const storesRes = await app
			.handle(authRequest("http://localhost/api/stores"))
			.then((r) => r.json());

		const ids = storesRes.stores.map((s: { id: string }) => s.id);
		expect(ids).not.toContain(storeId);

		// Apps from that store are gone (cascade delete)
		const appsRes = await app
			.handle(authRequest("http://localhost/api/apps"))
			.then((r) => r.json());

		const appIds = appsRes.apps.map((a: { id: string }) => a.id);
		expect(appIds).not.toContain(appId);

		// Prevent double-delete in afterAll
		storeId = "";
	});
});

describe("Integration: settings persist across updates", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(settingsController));

	it("PATCH bulk update then verify individual GET", async () => {
		await app.handle(
			authRequest("http://localhost/api/settings", {
				body: JSON.stringify({
					ai_model_generate: "google/gemini-2.5-pro",
					ai_model_rephrase: "anthropic/claude-sonnet-4",
					ai_temperature: "0.8",
				}),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);

		const genRes = await app
			.handle(
				authRequest("http://localhost/api/settings/ai_model_generate"),
			)
			.then((r) => r.json());
		expect(genRes.setting.value).toBe("google/gemini-2.5-pro");

		const repRes = await app
			.handle(
				authRequest("http://localhost/api/settings/ai_model_rephrase"),
			)
			.then((r) => r.json());
		expect(repRes.setting.value).toBe("anthropic/claude-sonnet-4");

		const tempRes = await app
			.handle(authRequest("http://localhost/api/settings/ai_temperature"))
			.then((r) => r.json());
		expect(tempRes.setting.value).toBe("0.8");
	});

	it("PUT overwrites individual setting", async () => {
		await app.handle(
			authRequest("http://localhost/api/settings/ai_temperature", {
				body: JSON.stringify({ value: "1.2" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		const res = await app
			.handle(authRequest("http://localhost/api/settings/ai_temperature"))
			.then((r) => r.json());
		expect(res.setting.value).toBe("1.2");
	});
});

describe("Integration: listings sync → edit draft → publish", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) =>
			app
				.use(storesController)
				.use(appsController)
				.use(listingsController),
		);

	let storeId: string;
	let appId: string;

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	it("setup store with apps", async () => {
		const res = await app
			.handle(
				authRequest("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Integration Listings Store",
						type: "google_play",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((r) => r.json());

		storeId = res.store.id;

		const appsRes = await app
			.handle(authRequest("http://localhost/api/apps"))
			.then((r) => r.json());
		appId = appsRes.apps[0].id;
	});

	it("sync listings from store", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/listings/sync`, {
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
	});

	it("get synced listings", async () => {
		const res = await app
			.handle(authRequest(`http://localhost/api/apps/${appId}/listings`))
			.then((r) => r.json());

		expect(res.listings).toBeArray();
		expect(res.listings.length).toBeGreaterThanOrEqual(1);
	});

	it("edit listing draft (local save)", async () => {
		const res = await app
			.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/en-US`,
					{
						body: JSON.stringify({
							title: "Updated Title",
							shortDesc: "Updated short description",
						}),
						headers: { "Content-Type": "application/json" },
						method: "PUT",
					},
				),
			)
			.then((r) => r.json());

		expect(res.listing.title).toBe("Updated Title");
		expect(res.listing.shortDesc).toBe("Updated short description");
	});

	it("verify draft persists on re-read", async () => {
		const res = await app
			.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/en-US`,
				),
			)
			.then((r) => r.json());

		// getByLanguage returns { draft, remote }
		expect(res.draft).not.toBeNull();
		expect(res.draft.title).toBe("Updated Title");
	});

	it("publish listings to store", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/listings/publish`, {
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
	});
});

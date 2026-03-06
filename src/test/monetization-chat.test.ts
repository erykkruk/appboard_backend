import { afterAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { monetizationChatController } from "@/modules/ai/monetization-chat.controller";
import { purchasesController } from "@/modules/purchases";
import { storesController } from "@/modules/stores";
import { db } from "@/utils/db";
import { apps } from "@/utils/db/schema";
import { authGuard, authRequest, authRequestB, cleanupStores } from "./setup";

describe("Monetization Chat", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) =>
			app
				.use(storesController)
				.use(purchasesController)
				.use(monetizationChatController),
		);

	let storeId: string;
	let appId: string;
	let storeIdB: string;
	let _appIdB: string;

	afterAll(async () => {
		const ids = [storeId, storeIdB].filter(Boolean) as string[];
		if (ids.length > 0) await cleanupStores(ids);
	});

	// ── Setup ──────────────────────────────────────────────────────

	it("sets up test store with apps (workspace A)", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/stores/connect", {
				body: JSON.stringify({
					credentials: { mock: true, type: "mock" },
					name: "Monetization Test Store",
					type: "google_play",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		const data = await res.json();
		storeId = data.store.id;
		expect(data.syncedApps).toBeGreaterThan(0);

		const appRows = await db
			.select({ id: apps.id })
			.from(apps)
			.where(eq(apps.storeId, storeId))
			.limit(1);
		appId = appRows[0].id;
		expect(appId).toBeDefined();
	});

	it("syncs purchases for the test app", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/purchases/sync`, {
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
	});

	it("sets up test store (workspace B)", async () => {
		const res = await app.handle(
			authRequestB("http://localhost/api/stores/connect", {
				body: JSON.stringify({
					credentials: { mock: true, type: "mock" },
					name: "Monetization Test Store B",
					type: "google_play",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		const data = await res.json();
		storeIdB = data.store.id;

		const appRows = await db
			.select({ id: apps.id })
			.from(apps)
			.where(eq(apps.storeId, storeIdB))
			.limit(1);
		_appIdB = appRows[0].id;
	});

	// ── Chat endpoint ──────────────────────────────────────────────

	it("chat endpoint returns 400 without API key configured", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/ai/monetization-chat", {
				body: JSON.stringify({
					appId,
					messages: [
						{
							content: "I want to add a premium subscription to my app",
							role: "user",
						},
					],
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		// Without OPENROUTER_API_KEY in settings, should return 400
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.code).toBe("BAD_REQUEST");
	});

	it("requires app ownership for chat", async () => {
		const res = await app.handle(
			authRequestB("http://localhost/api/ai/monetization-chat", {
				body: JSON.stringify({
					appId,
					messages: [{ content: "test", role: "user" }],
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(404);
	});

	// ── Execute endpoint ───────────────────────────────────────────

	it("executes a plan creating groups and subscriptions", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/ai/monetization-execute", {
				body: JSON.stringify({
					appId,
					plan: {
						groups: [
							{
								name: "AI Test Premium",
								subscriptions: [
									{
										duration: "P1M",
										name: "AI Test Monthly",
										prices: [
											{
												currency: "USD",
												price: "9.99",
												territory: "USA",
											},
										],
										productId: "ai_test_monthly",
									},
								],
							},
						],
					},
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.results.created.length).toBeGreaterThanOrEqual(2);
		expect(
			data.results.created.some(
				(c: { type: string }) => c.type === "subscription_group",
			),
		).toBe(true);
		expect(
			data.results.created.some(
				(c: { type: string }) => c.type === "subscription",
			),
		).toBe(true);
	});

	it("executes a plan creating standalone IAPs", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/ai/monetization-execute", {
				body: JSON.stringify({
					appId,
					plan: {
						purchases: [
							{
								name: "AI Test Remove Ads",
								prices: [
									{
										currency: "USD",
										price: "4.99",
										territory: "USA",
									},
								],
								productId: "ai_test_remove_ads",
								productType: "non_consumable",
							},
						],
					},
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.results.created.length).toBe(1);
		expect(data.results.created[0].name).toBe("AI Test Remove Ads");
	});

	it("executes a plan editing existing purchases", async () => {
		// First list purchases to get an ID
		const listRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/purchases`),
		);
		const listData = await listRes.json();
		const purchaseId = listData.purchases[0].id;

		const res = await app.handle(
			authRequest("http://localhost/api/ai/monetization-execute", {
				body: JSON.stringify({
					appId,
					plan: {
						edits: [
							{
								name: "AI Edited Purchase",
								purchaseId,
							},
						],
					},
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.results.edited.length).toBe(1);
		expect(data.results.edited[0].id).toBe(purchaseId);
	});

	it("executes a plan deleting purchases", async () => {
		// Create a purchase to delete
		const createRes = await app.handle(
			authRequest("http://localhost/api/ai/monetization-execute", {
				body: JSON.stringify({
					appId,
					plan: {
						purchases: [
							{
								name: "To Be Deleted",
								productId: "ai_test_to_delete",
								productType: "consumable",
							},
						],
					},
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		const createData = await createRes.json();
		const deleteId = createData.results.created[0].id;

		const res = await app.handle(
			authRequest("http://localhost/api/ai/monetization-execute", {
				body: JSON.stringify({
					appId,
					plan: {
						deletes: [deleteId],
					},
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.results.deleted).toContain(deleteId);
	});

	it("handles partial failures gracefully", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000099";

		const res = await app.handle(
			authRequest("http://localhost/api/ai/monetization-execute", {
				body: JSON.stringify({
					appId,
					plan: {
						edits: [
							{
								name: "Won't Work",
								purchaseId: fakeId,
							},
						],
					},
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.results.failed.length).toBeGreaterThanOrEqual(1);
		expect(data.results.edited.length).toBe(0);
	});

	// ── Workspace isolation ────────────────────────────────────────

	it("workspace B cannot execute plan on workspace A app", async () => {
		const res = await app.handle(
			authRequestB("http://localhost/api/ai/monetization-execute", {
				body: JSON.stringify({
					appId,
					plan: {
						purchases: [
							{
								name: "Cross Workspace Attack",
								productId: "attack_product",
								productType: "non_consumable",
							},
						],
					},
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(404);
	});
});

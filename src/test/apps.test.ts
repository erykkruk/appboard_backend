import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { storesController } from "@/modules/stores";
import { cleanupStores } from "./setup";

describe("Apps module", () => {
	const app = new Elysia().group("/api", (app) =>
		app.use(storesController).use(appsController),
	);

	let storeId: string;

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	it("sets up mock store with apps", async () => {
		const response = await app
			.handle(
				new Request("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Test GP Apps",
						type: "google_play",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		storeId = response.store.id;
	});

	it("GET /api/apps lists apps from connected store", async () => {
		const response = await app
			.handle(new Request("http://localhost/api/apps"))
			.then((res) => res.json());

		expect(response.apps).toBeArray();
		expect(response.apps.length).toBeGreaterThanOrEqual(3);
	});

	it("GET /api/apps?platform=android filters by platform", async () => {
		const response = await app
			.handle(new Request("http://localhost/api/apps?platform=android"))
			.then((res) => res.json());

		expect(response.apps).toBeArray();
		for (const a of response.apps) {
			expect(a.platform).toBe("android");
		}
	});

	it("GET /api/apps/:appId returns app detail", async () => {
		const listRes = await app
			.handle(new Request("http://localhost/api/apps"))
			.then((res) => res.json());

		const appId = listRes.apps[0].id;
		const response = await app
			.handle(new Request(`http://localhost/api/apps/${appId}`))
			.then((res) => res.json());

		expect(response.app).toBeDefined();
		expect(response.app.id).toBe(appId);
		expect(response.app.store).toBeDefined();
	});

	it("GET /api/apps/:appId returns 404 for non-existent app", async () => {
		const res = await app.handle(
			new Request(
				"http://localhost/api/apps/00000000-0000-0000-0000-000000000000",
			),
		);

		expect(res.status).toBe(404);
	});
});

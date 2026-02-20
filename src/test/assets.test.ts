import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { assetsController } from "@/modules/assets";
import { storesController } from "@/modules/stores";

describe("Assets module", () => {
	const app = new Elysia().group("/api", (app) =>
		app.use(storesController).use(appsController).use(assetsController),
	);

	let appId: string;

	it("sets up mock store and gets app ID", async () => {
		await app
			.handle(
				new Request("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Test GP Assets",
						type: "google_play",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		const appsRes = await app
			.handle(new Request("http://localhost/api/apps"))
			.then((res) => res.json());

		appId = appsRes.apps[0].id;
	});

	it("POST /api/apps/:appId/assets/sync syncs assets from store", async () => {
		const response = await app
			.handle(
				new Request(`http://localhost/api/apps/${appId}/assets/sync`, {
					method: "POST",
				}),
			)
			.then((res) => res.json());

		expect(response.synced).toBeGreaterThan(0);
	});

	it("GET /api/apps/:appId/assets lists all assets", async () => {
		const response = await app
			.handle(new Request(`http://localhost/api/apps/${appId}/assets`))
			.then((res) => res.json());

		expect(response.assets).toBeArray();
		expect(response.assets.length).toBeGreaterThan(0);
	});

	it("GET /api/apps/:appId/assets?language=en-US filters by language", async () => {
		const response = await app
			.handle(
				new Request(`http://localhost/api/apps/${appId}/assets?language=en-US`),
			)
			.then((res) => res.json());

		expect(response.assets).toBeArray();
		for (const asset of response.assets) {
			expect(asset.language).toBe("en-US");
		}
	});

	it("DELETE /api/apps/:appId/assets/:assetId deletes an asset", async () => {
		const listRes = await app
			.handle(new Request(`http://localhost/api/apps/${appId}/assets`))
			.then((res) => res.json());

		const assetId = listRes.assets[0].id;
		const response = await app
			.handle(
				new Request(`http://localhost/api/apps/${appId}/assets/${assetId}`, {
					method: "DELETE",
				}),
			)
			.then((res) => res.json());

		expect(response.success).toBe(true);
	});
});

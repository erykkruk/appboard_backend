import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { screenshotScenesController } from "@/modules/screenshot-scenes";
import type { SceneData } from "@/modules/screenshot-scenes/screenshot-scenes.types";
import { storesController } from "@/modules/stores";
import { errorHandler } from "@/utils/errors/errorHandler";
import { authGuard, authRequest, authRequestB, cleanupStores } from "./setup";
import { seedTestApp, seedTestStore } from "./test-helpers";

const SAMPLE_SCENE: SceneData = {
	annotations: [
		{ id: "a1", label: "New", radius: 8, type: "badge", x: 12, y: 34 },
	],
	background: {
		gradient: { angle: 45, from: "#ff0000", to: "#0000ff" },
		type: "gradient",
		value: "linear-gradient",
	},
	device: {
		frame: "iphone-15",
		offsetX: 0,
		offsetY: 10,
		rotation: 0,
		scale: 1,
	},
	height: 2796,
	screenshot: { fit: "cover", url: "https://example.com/shot.png" },
	textLayers: [
		{
			align: "center",
			color: "#ffffff",
			fontFamily: "Inter",
			fontSize: 64,
			id: "t1",
			text: "Plan your day",
			weight: 700,
			x: 100,
			y: 200,
		},
	],
	width: 1290,
};

describe("Screenshot scenes module", () => {
	const app = new Elysia()
		.use(authGuard)
		.use(errorHandler)
		.group("/api", (app) =>
			app
				.use(storesController)
				.use(appsController)
				.use(screenshotScenesController),
		);

	let storeId: string;
	let appId: string;
	let sceneId: string;

	beforeAll(async () => {
		const store = await seedTestStore();
		storeId = store.id;
		const seededApp = await seedTestApp(storeId);
		appId = seededApp.id;
	});

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	it("POST creates a scene with the jsonb payload intact", async () => {
		const res = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/screenshot-scenes`, {
					body: JSON.stringify({
						displayType: "iphone-6-7",
						language: "en-US",
						name: "Hero",
						scene: SAMPLE_SCENE,
						sortOrder: 1,
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((r) => r.json());

		sceneId = res.scene.id;
		expect(res.scene.id).toBeString();
		expect(res.scene.appId).toBe(appId);
		expect(res.scene.displayType).toBe("iphone-6-7");
		expect(res.scene.language).toBe("en-US");
		expect(res.scene.name).toBe("Hero");
		expect(res.scene.sortOrder).toBe(1);
		// jsonb round-trips byte-for-structure intact, including nested layers.
		expect(res.scene.scene).toEqual(SAMPLE_SCENE);
	});

	it("GET returns the scene with nested textLayers/annotations intact", async () => {
		const res = await app
			.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/screenshot-scenes/${sceneId}`,
				),
			)
			.then((r) => r.json());

		expect(res.scene.id).toBe(sceneId);
		expect(res.scene.scene).toEqual(SAMPLE_SCENE);
		expect(res.scene.scene.textLayers[0].text).toBe("Plan your day");
		expect(res.scene.scene.annotations[0].label).toBe("New");
	});

	it("GET list returns the created scene", async () => {
		const res = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/screenshot-scenes`),
			)
			.then((r) => r.json());

		expect(res.scenes).toBeArray();
		expect(res.scenes.some((s: { id: string }) => s.id === sceneId)).toBe(true);
	});

	it("PUT updates the scene json and round-trips intact", async () => {
		const updatedScene: SceneData = {
			...SAMPLE_SCENE,
			textLayers: [
				...SAMPLE_SCENE.textLayers,
				{
					align: "left",
					color: "#000000",
					fontFamily: "Roboto",
					fontSize: 32,
					id: "t2",
					text: "Subtitle",
					x: 50,
					y: 400,
				},
			],
		};

		const res = await app
			.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/screenshot-scenes/${sceneId}`,
					{
						body: JSON.stringify({
							name: "Hero updated",
							scene: updatedScene,
							sortOrder: 5,
						}),
						headers: { "Content-Type": "application/json" },
						method: "PUT",
					},
				),
			)
			.then((r) => r.json());

		expect(res.scene.name).toBe("Hero updated");
		expect(res.scene.sortOrder).toBe(5);
		expect(res.scene.scene).toEqual(updatedScene);
		expect(res.scene.scene.textLayers).toHaveLength(2);
	});

	it("DELETE removes the scene", async () => {
		const delRes = await app
			.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/screenshot-scenes/${sceneId}`,
					{ method: "DELETE" },
				),
			)
			.then((r) => r.json());
		expect(delRes.success).toBe(true);

		const getRes = await app.handle(
			authRequest(
				`http://localhost/api/apps/${appId}/screenshot-scenes/${sceneId}`,
			),
		);
		expect(getRes.status).toBe(404);
	});

	describe("workspace isolation", () => {
		let isolatedSceneId: string;

		beforeAll(async () => {
			const res = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/screenshot-scenes`, {
						body: JSON.stringify({
							displayType: "iphone-6-7",
							language: "en-US",
							name: "Workspace A scene",
							scene: SAMPLE_SCENE,
						}),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					}),
				)
				.then((r) => r.json());
			isolatedSceneId = res.scene.id;
		});

		it("workspace B cannot list workspace A scenes (404)", async () => {
			const res = await app.handle(
				authRequestB(`http://localhost/api/apps/${appId}/screenshot-scenes`),
			);
			expect(res.status).toBe(404);
		});

		it("workspace B cannot get a workspace A scene (404)", async () => {
			const res = await app.handle(
				authRequestB(
					`http://localhost/api/apps/${appId}/screenshot-scenes/${isolatedSceneId}`,
				),
			);
			expect(res.status).toBe(404);
		});

		it("workspace B cannot create a scene on workspace A app (404)", async () => {
			const res = await app.handle(
				authRequestB(`http://localhost/api/apps/${appId}/screenshot-scenes`, {
					body: JSON.stringify({
						displayType: "iphone-6-7",
						language: "en-US",
						name: "Intruder",
						scene: SAMPLE_SCENE,
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			);
			expect(res.status).toBe(404);
		});

		it("workspace B cannot update a workspace A scene (404)", async () => {
			const res = await app.handle(
				authRequestB(
					`http://localhost/api/apps/${appId}/screenshot-scenes/${isolatedSceneId}`,
					{
						body: JSON.stringify({ name: "Hacked" }),
						headers: { "Content-Type": "application/json" },
						method: "PUT",
					},
				),
			);
			expect(res.status).toBe(404);
		});

		it("workspace B cannot delete a workspace A scene (404)", async () => {
			const res = await app.handle(
				authRequestB(
					`http://localhost/api/apps/${appId}/screenshot-scenes/${isolatedSceneId}`,
					{ method: "DELETE" },
				),
			);
			expect(res.status).toBe(404);
		});
	});
});

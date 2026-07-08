import Elysia from "elysia";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import {
	createSceneBody,
	sceneIdParams,
	sceneParams,
	updateSceneBody,
} from "./screenshot-scenes.schema";
import { ScreenshotScenesService } from "./screenshot-scenes.service";
import type { SceneData } from "./screenshot-scenes.types";

export const screenshotScenesController = new Elysia({ prefix: "/apps" })
	.get(
		"/:appId/screenshot-scenes",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const scenes = await ScreenshotScenesService.getAll(params.appId);
			return { scenes };
		},
		{
			detail: {
				description: "List screenshot editor scenes for an app",
				tags: ["Screenshot Scenes"],
			},
			params: sceneParams,
		},
	)
	.get(
		"/:appId/screenshot-scenes/:sceneId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const scene = await ScreenshotScenesService.getById(
				params.appId,
				params.sceneId,
			);
			return { scene };
		},
		{
			detail: {
				description: "Get a single screenshot editor scene",
				tags: ["Screenshot Scenes"],
			},
			params: sceneIdParams,
		},
	)
	.post(
		"/:appId/screenshot-scenes",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const scene = await ScreenshotScenesService.create(params.appId, {
				displayType: body.displayType,
				language: body.language,
				name: body.name,
				scene: body.scene as unknown as SceneData,
				sortOrder: body.sortOrder,
			});
			return { scene };
		},
		{
			body: createSceneBody,
			detail: {
				description: "Create a screenshot editor scene",
				tags: ["Screenshot Scenes"],
			},
			params: sceneParams,
		},
	)
	.put(
		"/:appId/screenshot-scenes/:sceneId",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const scene = await ScreenshotScenesService.update(
				params.appId,
				params.sceneId,
				{
					assetId: body.assetId,
					name: body.name,
					scene: body.scene as unknown as SceneData | undefined,
					sortOrder: body.sortOrder,
				},
			);
			return { scene };
		},
		{
			body: updateSceneBody,
			detail: {
				description: "Update a screenshot editor scene",
				tags: ["Screenshot Scenes"],
			},
			params: sceneIdParams,
		},
	)
	.delete(
		"/:appId/screenshot-scenes/:sceneId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return ScreenshotScenesService.delete(params.appId, params.sceneId);
		},
		{
			detail: {
				description: "Delete a screenshot editor scene",
				tags: ["Screenshot Scenes"],
			},
			params: sceneIdParams,
		},
	);

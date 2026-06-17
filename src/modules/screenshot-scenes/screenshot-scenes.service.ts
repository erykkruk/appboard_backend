import { and, asc, eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { screenshotScenes } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import type {
	CreateSceneInput,
	UpdateSceneInput,
} from "./screenshot-scenes.types";

export class ScreenshotScenesService {
	static async getAll(appId: string) {
		return db
			.select()
			.from(screenshotScenes)
			.where(eq(screenshotScenes.appId, appId))
			.orderBy(
				asc(screenshotScenes.sortOrder),
				asc(screenshotScenes.createdAt),
			);
	}

	static async getById(appId: string, sceneId: string) {
		const [scene] = await db
			.select()
			.from(screenshotScenes)
			.where(
				and(
					eq(screenshotScenes.id, sceneId),
					eq(screenshotScenes.appId, appId),
				),
			)
			.limit(1);

		if (!scene) buildError("notFound", { info: "Scene not found" });
		return scene;
	}

	static async create(appId: string, data: CreateSceneInput) {
		const [scene] = await db
			.insert(screenshotScenes)
			.values({
				appId,
				displayType: data.displayType,
				language: data.language,
				name: data.name,
				scene: data.scene,
				sortOrder: data.sortOrder ?? 0,
			})
			.returning();
		return scene;
	}

	static async update(appId: string, sceneId: string, data: UpdateSceneInput) {
		// Ensure the scene exists within this app before mutating.
		await ScreenshotScenesService.getById(appId, sceneId);

		const [scene] = await db
			.update(screenshotScenes)
			.set({
				...(data.assetId !== undefined && { assetId: data.assetId }),
				...(data.name !== undefined && { name: data.name }),
				...(data.scene !== undefined && { scene: data.scene }),
				...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
			})
			.where(
				and(
					eq(screenshotScenes.id, sceneId),
					eq(screenshotScenes.appId, appId),
				),
			)
			.returning();
		return scene;
	}

	static async delete(appId: string, sceneId: string) {
		await ScreenshotScenesService.getById(appId, sceneId);

		await db
			.delete(screenshotScenes)
			.where(
				and(
					eq(screenshotScenes.id, sceneId),
					eq(screenshotScenes.appId, appId),
				),
			);
		return { success: true };
	}
}

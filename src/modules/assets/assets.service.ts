import { and, eq } from "drizzle-orm";
import type { StoreType } from "@/config/const";
import { createProvider } from "@/providers";
import { decrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { apps, assets, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("assets-service");

export class AssetsService {
	static async syncFromStore(appId: string) {
		const app = await AssetsService.getAppWithStore(appId);
		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const provider = createProvider(app.store.type as StoreType, credentials);

		// Fetch assets for all common languages
		const languages = ["en-US", "pl-PL", "de-DE"];
		let totalSynced = 0;

		for (const language of languages) {
			const fetched = await provider.fetchAssets(app.externalId, language);

			for (const asset of fetched) {
				const existing = await db
					.select()
					.from(assets)
					.where(
						and(
							eq(assets.appId, appId),
							eq(assets.externalId, asset.externalId),
						),
					)
					.limit(1);

				if (existing.length > 0) {
					await db
						.update(assets)
						.set({
							fileSize: asset.fileSize,
							height: asset.height,
							syncedAt: new Date(),
							url: asset.url,
							width: asset.width,
						})
						.where(eq(assets.id, existing[0].id));
				} else {
					await db.insert(assets).values({
						appId,
						assetType: asset.assetType,
						deviceType: asset.deviceType,
						externalId: asset.externalId,
						fileSize: asset.fileSize,
						height: asset.height,
						language,
						sortOrder: totalSynced,
						syncedAt: new Date(),
						url: asset.url,
						width: asset.width,
					});
				}
				totalSynced++;
			}
		}

		log.info({ appId, count: totalSynced }, "Assets synced from store");
		return { synced: totalSynced };
	}

	static async getAll(
		appId: string,
		filters?: { assetType?: string; deviceType?: string; language?: string },
	) {
		const conditions = [eq(assets.appId, appId)];

		if (filters?.language) {
			conditions.push(eq(assets.language, filters.language));
		}
		if (filters?.assetType) {
			conditions.push(eq(assets.assetType, filters.assetType));
		}
		if (filters?.deviceType) {
			conditions.push(eq(assets.deviceType, filters.deviceType));
		}

		return db
			.select()
			.from(assets)
			.where(and(...conditions))
			.orderBy(assets.sortOrder);
	}

	static async upload(
		appId: string,
		language: string,
		assetType: string,
		deviceType: string,
		file: Buffer,
	) {
		const app = await AssetsService.getAppWithStore(appId);
		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const provider = createProvider(app.store.type as StoreType, credentials);

		const result = await provider.uploadAsset(app.externalId, language, file, {
			assetType,
			deviceType,
		});

		const [asset] = await db
			.insert(assets)
			.values({
				appId,
				assetType: result.assetType,
				deviceType: result.deviceType,
				externalId: result.externalId,
				fileSize: result.fileSize,
				height: result.height,
				language,
				sortOrder: 0,
				url: result.url,
				width: result.width,
			})
			.returning();

		return asset;
	}

	static async deleteAsset(appId: string, assetId: string) {
		const [asset] = await db
			.select()
			.from(assets)
			.where(and(eq(assets.id, assetId), eq(assets.appId, appId)))
			.limit(1);

		if (!asset) {
			buildError("notFound", { info: "Asset not found" });
			throw new Error("unreachable");
		}

		if (asset.externalId) {
			const app = await AssetsService.getAppWithStore(appId);
			const credentials = JSON.parse(decrypt(app.store.credentials!));
			const provider = createProvider(app.store.type as StoreType, credentials);
			await provider.deleteAsset(app.externalId, asset.externalId);
		}

		await db.delete(assets).where(eq(assets.id, assetId));
		return { success: true };
	}

	static async reorder(items: { id: string; sortOrder: number }[]) {
		for (const item of items) {
			await db
				.update(assets)
				.set({ sortOrder: item.sortOrder })
				.where(eq(assets.id, item.id));
		}
		return { success: true };
	}

	private static async getAppWithStore(appId: string) {
		const result = await db
			.select({ app: apps, store: stores })
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(eq(apps.id, appId))
			.limit(1);

		if (result.length === 0) {
			buildError("notFound", { info: "App not found" });
			throw new Error("unreachable");
		}

		return { ...result[0].app, store: result[0].store };
	}
}

import { and, eq } from "drizzle-orm";
import type { StoreType } from "@/config/const";
import { decryptCredentials } from "@/modules/vault/credentials";
import { createProvider } from "@/providers";
import { db } from "@/utils/db";
import { apps, assets, listings, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("assets-service");

export class AssetsService {
	static async syncFromStore(appId: string) {
		const app = await AssetsService.getAppWithStore(appId);
		const credentials = decryptCredentials(
			app.store.credentials!,
			app.store.workspaceId,
		);
		const provider = createProvider(app.store.type as StoreType, credentials);

		// Derive languages from existing listings (synced from store)
		const appListings = await db
			.select({ language: listings.language })
			.from(listings)
			.where(eq(listings.appId, appId));
		const languageSet = new Set(appListings.map((l) => l.language));
		// Ensure at least en-US so we always try the default language
		if (languageSet.size === 0) {
			languageSet.add("en-US");
		}
		const languages = [...languageSet];
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

		// Update app iconUrl from synced icon asset
		const [iconAsset] = await db
			.select({ url: assets.url })
			.from(assets)
			.where(and(eq(assets.appId, appId), eq(assets.assetType, "icon")))
			.limit(1);

		await db
			.update(apps)
			.set({
				iconUrl: iconAsset?.url ?? undefined,
				lastSyncedAt: new Date(),
			})
			.where(eq(apps.id, appId));

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
		fileName?: string,
	) {
		const app = await AssetsService.getAppWithStore(appId);
		const credentials = decryptCredentials(
			app.store.credentials!,
			app.store.workspaceId,
		);
		const provider = createProvider(app.store.type as StoreType, credentials);

		const result = await provider.uploadAsset(app.externalId, language, file, {
			assetType,
			deviceType,
			fileName,
		});

		const [asset] = await db
			.insert(assets)
			.values({
				appId,
				assetType: result.assetType,
				deviceType: result.deviceType,
				externalId: result.externalId,
				fileName,
				fileSize: result.fileSize,
				height: result.height,
				isDirty: true,
				language,
				sortOrder: 0,
				source: "draft",
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

		if (!asset) buildError("notFound", { info: "Asset not found" });

		// Draft assets without externalId can be deleted directly
		if (asset.source === "draft" && !asset.externalId) {
			await db.delete(assets).where(eq(assets.id, assetId));
			return { success: true };
		}

		// Remote or uploaded assets — delete from store first
		if (asset.externalId) {
			const app = await AssetsService.getAppWithStore(appId);
			const credentials = decryptCredentials(
				app.store.credentials!,
				app.store.workspaceId,
			);
			const provider = createProvider(app.store.type as StoreType, credentials);
			await provider.deleteAsset(app.externalId, asset.externalId);
		}

		await db.delete(assets).where(eq(assets.id, assetId));
		return { success: true };
	}

	static async publishAssets(appId: string) {
		const dirtyAssets = await db
			.select()
			.from(assets)
			.where(and(eq(assets.appId, appId), eq(assets.isDirty, true)));

		if (dirtyAssets.length === 0) {
			return { published: 0 };
		}

		for (const asset of dirtyAssets) {
			// Mark as clean after successful upload (assets are already uploaded at upload time)
			await db
				.update(assets)
				.set({ isDirty: false, source: "remote" })
				.where(eq(assets.id, asset.id));
		}

		log.info({ appId, count: dirtyAssets.length }, "Assets published");
		return { published: dirtyAssets.length };
	}

	static async getDirtyCount(appId: string) {
		const dirty = await db
			.select()
			.from(assets)
			.where(and(eq(assets.appId, appId), eq(assets.isDirty, true)));
		return {
			added: dirty.filter((a) => a.source === "draft").length,
			count: dirty.length,
			removed: 0,
		};
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

		if (result.length === 0) buildError("notFound", { info: "App not found" });

		return { ...result[0].app, store: result[0].store };
	}
}

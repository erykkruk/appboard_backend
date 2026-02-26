import { and, eq } from "drizzle-orm";
import type { StoreType } from "@/config/const";
import { createProvider } from "@/providers";
import type { StoreProvider } from "@/providers/store-provider";
import { decrypt, encrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { apps, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("stores-service");

export class StoresService {
	static async connect(
		workspaceId: string,
		name: string,
		type: StoreType,
		credentials: Record<string, unknown>,
	) {
		const provider = createProvider(type, credentials);
		const valid = await provider.validateCredentials();
		if (!valid) {
			buildError("storeConnectionFailed", {
				info: "Invalid store credentials",
			});
		}

		const encryptedCreds = encrypt(JSON.stringify(credentials));
		const [store] = await db
			.insert(stores)
			.values({
				credentials: encryptedCreds,
				name,
				status: "connected",
				type,
				workspaceId,
			})
			.returning();

		const syncResult = await StoresService.syncApps(store.id);
		return { store, syncedApps: syncResult.synced };
	}

	static async list(workspaceId: string) {
		return db.select().from(stores).where(eq(stores.workspaceId, workspaceId));
	}

	static async disconnect(storeId: string, workspaceId: string) {
		const [store] = await db
			.select()
			.from(stores)
			.where(and(eq(stores.id, storeId), eq(stores.workspaceId, workspaceId)))
			.limit(1);

		if (!store) buildError("notFound", { info: "Store not found" });

		await db.delete(stores).where(eq(stores.id, storeId));
		return { success: true };
	}

	static async syncApps(storeId: string) {
		const [store] = await db
			.select()
			.from(stores)
			.where(eq(stores.id, storeId))
			.limit(1);

		if (!store) buildError("notFound", { info: "Store not found" });
		if (!store.credentials) {
			buildError("storeConnectionFailed", {
				info: "Store has no credentials",
			});
		}

		const credentials = JSON.parse(decrypt(store.credentials));
		const provider = createProvider(store.type as StoreType, credentials);
		const fetchedApps = await provider.fetchApps();

		for (const appData of fetchedApps) {
			// Look up by externalId globally (not scoped to storeId) to handle
			// reconnects where the store row was recreated with a new UUID.
			const existing = await db
				.select()
				.from(apps)
				.where(eq(apps.externalId, appData.externalId))
				.limit(1);

			if (existing.length > 0) {
				await db
					.update(apps)
					.set({
						bundleId: appData.bundleId,
						iconUrl: appData.iconUrl,
						lastSyncedAt: new Date(),
						name: appData.name,
						platform: appData.platform,
						storeId,
					})
					.where(eq(apps.id, existing[0].id));
			} else {
				await db.insert(apps).values({
					bundleId: appData.bundleId,
					externalId: appData.externalId,
					iconUrl: appData.iconUrl,
					lastSyncedAt: new Date(),
					name: appData.name,
					platform: appData.platform,
					storeId,
				});
			}
		}

		await db
			.update(stores)
			.set({ lastSyncedAt: new Date() })
			.where(eq(stores.id, storeId));

		log.info({ appCount: fetchedApps.length, storeId }, "Apps synced");
		return { synced: fetchedApps.length };
	}

	static async syncAll(workspaceId: string) {
		const connectedStores = await db
			.select()
			.from(stores)
			.where(
				and(eq(stores.workspaceId, workspaceId), eq(stores.status, "connected")),
			);

		const results: { storeId: string; storeName: string; synced: number }[] =
			[];

		for (const store of connectedStores) {
			const result = await StoresService.syncApps(store.id);
			results.push({
				storeId: store.id,
				storeName: store.name,
				synced: result.synced,
			});
		}

		const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
		log.info(
			{ storeCount: connectedStores.length, totalSynced, workspaceId },
			"All stores synced",
		);

		return { results, totalSynced };
	}

	static getProvider(store: {
		credentials: string | null;
		type: string;
	}): StoreProvider {
		if (!store.credentials) {
			buildError("storeConnectionFailed", {
				info: "Store has no credentials",
			});
			throw new Error("unreachable");
		}
		const credentials = JSON.parse(decrypt(store.credentials));
		return createProvider(store.type as StoreType, credentials);
	}
}

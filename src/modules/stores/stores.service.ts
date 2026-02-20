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
			})
			.returning();

		await StoresService.syncApps(store.id);
		return store;
	}

	static async list() {
		return db.select().from(stores);
	}

	static async disconnect(storeId: string) {
		const [store] = await db
			.select()
			.from(stores)
			.where(eq(stores.id, storeId))
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
			const existing = await db
				.select()
				.from(apps)
				.where(
					and(
						eq(apps.externalId, appData.externalId),
						eq(apps.storeId, storeId),
					),
				)
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

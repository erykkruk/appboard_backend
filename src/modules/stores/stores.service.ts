import { and, eq } from "drizzle-orm";
import type { StoreType } from "@/config/const";
import {
	resolveDefaultCapabilities,
	validateCapabilitySelection,
} from "@/config/store-capabilities";
import {
	decryptCredentials,
	encryptCredentials,
} from "@/modules/vault/credentials";
import { createProvider } from "@/providers";
import type { StoreProvider } from "@/providers/store-provider";
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
		capabilities?: string[],
	) {
		const provider = createProvider(type, credentials);
		const validation = await provider.validateCredentials();
		if (!validation.valid) {
			buildError("storeConnectionFailed", {
				info: validation.reason
					? `Invalid store credentials: ${validation.reason}`
					: "Invalid store credentials",
			});
		}

		// Omitted → NULL (treated as all-selectable at read time), preserving the
		// existing "connect grants everything" behaviour for callers that don't
		// send a selection. An explicit selection is validated against the catalog.
		const resolvedCapabilities = capabilities
			? validateCapabilitySelection(type, capabilities)
			: null;

		const encryptedCreds = await encryptCredentials(credentials, workspaceId);
		const [store] = await db
			.insert(stores)
			.values({
				capabilities: resolvedCapabilities,
				credentials: encryptedCreds,
				name,
				status: "connected",
				type,
				workspaceId,
			})
			.returning();

		const syncResult = await StoresService.syncApps(store.id);
		return {
			capabilities: resolvedCapabilities ?? resolveDefaultCapabilities(type),
			store,
			syncedApps: syncResult.synced,
		};
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

	static async rename(storeId: string, workspaceId: string, name: string) {
		const trimmed = name.trim();
		if (!trimmed) {
			buildError("badRequest", { info: "Store name cannot be empty" });
		}

		const [updated] = await db
			.update(stores)
			.set({ name: trimmed })
			.where(and(eq(stores.id, storeId), eq(stores.workspaceId, workspaceId)))
			.returning();

		if (!updated) buildError("notFound", { info: "Store not found" });

		log.info({ storeId }, "Store renamed");
		return updated;
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

		const credentials = decryptCredentials(
			store.credentials,
			store.workspaceId,
		);
		const provider = createProvider(store.type as StoreType, credentials);

		let fetchedApps: Awaited<ReturnType<StoreProvider["fetchApps"]>>;
		try {
			fetchedApps = await provider.fetchApps();
		} catch (err) {
			// Surface broken connections instead of silently staying "connected":
			// the panel renders this status and the user sees the real reason.
			await db
				.update(stores)
				.set({ status: "error" })
				.where(eq(stores.id, storeId));
			log.error({ err, storeId }, "App sync failed — store marked as error");
			buildError("storeApiError", {
				info: `Store sync failed: ${err instanceof Error ? err.message : String(err)}`,
			});
		}

		for (const appData of fetchedApps) {
			// Look up by externalId within the same workspace to handle
			// reconnects where the store row was recreated with a new UUID.
			const existing = await db
				.select({ id: apps.id })
				.from(apps)
				.innerJoin(stores, eq(apps.storeId, stores.id))
				.where(
					and(
						eq(apps.externalId, appData.externalId),
						eq(stores.workspaceId, store.workspaceId),
					),
				)
				.limit(1);

			const appStatus = appData.isDraft ? "draft" : "active";

			if (existing.length > 0) {
				await db
					.update(apps)
					.set({
						bundleId: appData.bundleId,
						iconUrl: appData.iconUrl,
						lastSyncedAt: new Date(),
						name: appData.name,
						platform: appData.platform,
						status: appStatus,
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
					status: appStatus,
					storeId,
				});
			}
		}

		// Successful sync also recovers stores previously marked as "error".
		await db
			.update(stores)
			.set({ lastSyncedAt: new Date(), status: "connected" })
			.where(eq(stores.id, storeId));

		log.info({ appCount: fetchedApps.length, storeId }, "Apps synced");
		return { synced: fetchedApps.length };
	}

	static async syncAll(workspaceId: string) {
		const connectedStores = await db
			.select()
			.from(stores)
			.where(
				and(
					eq(stores.workspaceId, workspaceId),
					eq(stores.status, "connected"),
				),
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
		}
		const credentials = decryptCredentials(
			store.credentials,
			store.workspaceId,
		);
		return createProvider(store.type as StoreType, credentials);
	}
}

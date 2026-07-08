import { and, eq } from "drizzle-orm";
import type { StoreType } from "@/config/const";
import {
	resolveDefaultCapabilities,
	type StoreCapabilityId,
	validateCapabilitySelection,
} from "@/config/store-capabilities";
import { db } from "@/utils/db";
import { apps, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

export interface ResolvedCapabilities {
	storeType: StoreType;
	capabilities: StoreCapabilityId[];
}

/**
 * Turn a stored capability value into the effective enabled set. A NULL value
 * (legacy row or never set) resolves to the store type's defaults so existing
 * connections keep full access.
 */
export function resolveStoredCapabilities(
	storeType: StoreType,
	stored: string[] | null,
): StoreCapabilityId[] {
	if (stored == null) return resolveDefaultCapabilities(storeType);
	return validateCapabilitySelection(storeType, stored);
}

export class StoreCapabilitiesService {
	/** Effective capabilities for a store (does not check ownership). */
	static async getForStore(
		storeId: string,
	): Promise<ResolvedCapabilities | null> {
		const [store] = await db
			.select({ capabilities: stores.capabilities, type: stores.type })
			.from(stores)
			.where(eq(stores.id, storeId))
			.limit(1);
		if (!store) return null;
		const storeType = store.type as StoreType;
		return {
			capabilities: resolveStoredCapabilities(storeType, store.capabilities),
			storeType,
		};
	}

	/** Effective capabilities for the store an app belongs to. */
	static async getForApp(appId: string): Promise<ResolvedCapabilities | null> {
		const [row] = await db
			.select({ capabilities: stores.capabilities, type: stores.type })
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(eq(apps.id, appId))
			.limit(1);
		if (!row) return null;
		const storeType = row.type as StoreType;
		return {
			capabilities: resolveStoredCapabilities(storeType, row.capabilities),
			storeType,
		};
	}

	/** Update a store's capability selection (workspace-scoped). */
	static async setForStore(
		storeId: string,
		workspaceId: string,
		ids: readonly string[],
	): Promise<ResolvedCapabilities> {
		const [store] = await db
			.select({ type: stores.type })
			.from(stores)
			.where(and(eq(stores.id, storeId), eq(stores.workspaceId, workspaceId)))
			.limit(1);
		if (!store) buildError("notFound", { info: "Store not found" });

		const storeType = store.type as StoreType;
		const capabilities = validateCapabilitySelection(storeType, ids);

		await db.update(stores).set({ capabilities }).where(eq(stores.id, storeId));

		return { capabilities, storeType };
	}
}

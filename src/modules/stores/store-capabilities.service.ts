import { and, eq } from "drizzle-orm";
import type { StoreType } from "@/config/const";
import {
	getCapabilityDefinitions,
	resolveDefaultCapabilities,
	type StoreCapabilityId,
	validateCapabilitySelection,
} from "@/config/store-capabilities";
import { decryptCredentials } from "@/modules/vault/credentials";
import { createProvider } from "@/providers";
import type { CapabilityAccessResult } from "@/providers/store-provider";
import { db } from "@/utils/db";
import { apps, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

export interface ResolvedCapabilities {
	storeType: StoreType;
	capabilities: StoreCapabilityId[];
}

export interface CapabilityAccessEntry {
	id: StoreCapabilityId;
	detail?: string;
	status: CapabilityAccessResult["status"];
}

export interface CapabilityAccessReport {
	storeType: StoreType;
	results: CapabilityAccessEntry[];
}

/**
 * Map a provider's raw probe results onto the full capability catalog for a
 * store type, so every capability has an entry. Capabilities the provider did
 * not report default to `unsupported` (console-only) or `unknown`.
 */
function mapAccessResults(
	storeType: StoreType,
	raw: CapabilityAccessResult[],
): CapabilityAccessEntry[] {
	const byId = new Map(raw.map((r) => [r.capability, r]));
	return getCapabilityDefinitions(storeType).map((def) => {
		const hit = byId.get(def.id);
		return {
			detail: hit?.detail,
			id: def.id,
			status: hit?.status ?? (def.consoleOnly ? "unsupported" : "unknown"),
		};
	});
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

	/**
	 * Probe access for raw (not-yet-stored) credentials — used right after the
	 * user enters a key, before saving. Does not touch the database or the vault.
	 */
	static async verifyAccessRaw(
		storeType: StoreType,
		credentials: Record<string, unknown>,
	): Promise<CapabilityAccessReport> {
		const provider = createProvider(storeType, credentials);
		const raw = provider.verifyCapabilityAccess
			? await provider.verifyCapabilityAccess()
			: [];
		return { results: mapAccessResults(storeType, raw), storeType };
	}

	/**
	 * Probe access for an already-connected store. Decrypts the stored
	 * credentials, so the vault must be unlocked (otherwise a 423 is raised).
	 */
	static async verifyAccessStored(
		storeId: string,
		workspaceId: string,
	): Promise<CapabilityAccessReport> {
		const [store] = await db
			.select()
			.from(stores)
			.where(and(eq(stores.id, storeId), eq(stores.workspaceId, workspaceId)))
			.limit(1);
		if (!store) buildError("notFound", { info: "Store not found" });
		if (!store.credentials) {
			buildError("storeConnectionFailed", { info: "Store has no credentials" });
		}

		const storeType = store.type as StoreType;
		const credentials = decryptCredentials(store.credentials, workspaceId);
		const provider = createProvider(storeType, credentials);
		const raw = provider.verifyCapabilityAccess
			? await provider.verifyCapabilityAccess()
			: [];
		return { results: mapAccessResults(storeType, raw), storeType };
	}
}

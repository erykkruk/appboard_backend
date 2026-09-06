import { DEFAULT_PUBLIC_COUNTRY, type StoreType } from "@/config/const";
import { decryptCredentials } from "@/modules/vault/credentials";
import { createProvider } from "@/providers";
import {
	createPublicProvider,
	type PublicProviderContext,
} from "@/providers/public";
import type { StoreProvider } from "@/providers/store-provider";
import { buildError } from "@/utils/errors";

export interface StoreRowForProvider {
	connectionMode: string;
	credentials: string | null;
	type: string;
	workspaceId: string;
}

export function isPublicStore(store: { connectionMode: string }): boolean {
	return store.connectionMode === "public";
}

/** Country a link-imported app was pinned to at import time (default "us"). */
export function publicCountryFor(app: { rawData?: unknown }): string {
	const raw = app.rawData as { publicCountry?: unknown } | null | undefined;
	return typeof raw?.publicCountry === "string" && raw.publicCountry
		? raw.publicCountry
		: DEFAULT_PUBLIC_COUNTRY;
}

/**
 * The single choke point for turning a store row into a provider. API
 * connections decrypt their credentials as before; public (link) connections
 * get a credential-less provider that serves public store data and raises a
 * typed 403 INTEGRATION_REQUIRED on every write.
 */
export function resolveProviderForStore(
	store: StoreRowForProvider,
	context?: PublicProviderContext,
): StoreProvider {
	if (isPublicStore(store)) {
		return createPublicProvider(store.type as StoreType, context);
	}
	if (!store.credentials) {
		buildError("storeConnectionFailed", { info: "Store has no credentials" });
	}
	const credentials = decryptCredentials(store.credentials, store.workspaceId);
	return createProvider(store.type as StoreType, credentials);
}

/** Resolver shorthand for the common per-app case (uses the app's country). */
export function resolveProviderForApp(app: {
	rawData?: unknown;
	store: StoreRowForProvider;
}): StoreProvider {
	return resolveProviderForStore(app.store, {
		country: publicCountryFor(app),
	});
}

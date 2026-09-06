import type { StoreType } from "@/config/const";
import type { StoreProvider } from "@/providers/store-provider";
import { buildError } from "@/utils/errors";
import { PublicAppStoreProvider } from "./app-store";
import type { PublicProviderContext } from "./base";
import { PublicGooglePlayProvider } from "./google-play";

export type { PublicProviderContext } from "./base";
export { PublicStoreProvider } from "./base";

/** Public (credential-less) connections exist for the primary stores only. */
export function createPublicProvider(
	storeType: StoreType,
	context: PublicProviderContext = {},
): StoreProvider {
	switch (storeType) {
		case "app_store":
			return new PublicAppStoreProvider(context);
		case "google_play":
			return new PublicGooglePlayProvider(context);
		default:
			return buildError("badRequest", {
				info: `Public link connections are not supported for store type "${storeType}".`,
			});
	}
}

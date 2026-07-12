import { isAlternativeStoreType, type StoreType } from "@/config/const";
import { AppStoreProvider } from "./app-store";
import { GooglePlayProvider } from "./google-play";
import { MockStoreProvider } from "./mock";
import type { StoreProvider } from "./store-provider";

export function createProvider(
	storeType: StoreType,
	credentials: Record<string, unknown>,
): StoreProvider {
	switch (storeType) {
		case "google_play":
			return new GooglePlayProvider(credentials);
		case "app_store":
			return new AppStoreProvider(credentials);
		default:
			// Alternative stores (Huawei AppGallery, Amazon Appstore, …) are served
			// by the generic stub provider until a real integration lands.
			if (isAlternativeStoreType(storeType)) {
				return new MockStoreProvider(storeType, credentials);
			}
			throw new Error(`Unsupported store type: ${String(storeType)}`);
	}
}

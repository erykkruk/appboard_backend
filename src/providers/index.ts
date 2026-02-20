import type { StoreType } from "@/config/const";
import { AppStoreProvider } from "./app-store";
import { GooglePlayProvider } from "./google-play";
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
	}
}

import { isAlternativeStoreType, type StoreType } from "@/config/const";
import { AmazonAppstoreProvider } from "./amazon-appstore";
import { AppStoreProvider } from "./app-store";
import { GooglePlayProvider } from "./google-play";
import { HuaweiAppGalleryProvider } from "./huawei-appgallery";
import { MockStoreProvider } from "./mock";
import { OneStoreProvider } from "./onestore";
import { RuStoreProvider } from "./rustore";
import { SamsungGalaxyProvider } from "./samsung-galaxy";
import type { StoreProvider } from "./store-provider";
import { XiaomiGetAppsProvider } from "./xiaomi-getapps";

export function createProvider(
	storeType: StoreType,
	credentials: Record<string, unknown>,
): StoreProvider {
	// Seeded demo/test connections opt into canned data with `mock: true`, the
	// same flag the App Store provider honours.
	if (credentials.mock === true && isAlternativeStoreType(storeType)) {
		return new MockStoreProvider(storeType, credentials);
	}

	switch (storeType) {
		case "google_play":
			return new GooglePlayProvider(credentials);
		case "app_store":
			return new AppStoreProvider(credentials);
		case "huawei_appgallery":
			return new HuaweiAppGalleryProvider(credentials);
		case "samsung_galaxy":
			return new SamsungGalaxyProvider(credentials);
		case "amazon_appstore":
			return new AmazonAppstoreProvider(credentials);
		case "rustore":
			return new RuStoreProvider(credentials);
		case "onestore":
			return new OneStoreProvider(credentials);
		case "xiaomi_getapps":
			return new XiaomiGetAppsProvider(credentials);
		default:
			throw new Error(`Unsupported store type: ${String(storeType)}`);
	}
}

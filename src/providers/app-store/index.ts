import {
	getMockAssets,
	getMockListings,
	getMockReviews,
	MOCK_IOS_APPS,
} from "@/providers/mock-data";
import type {
	AppData,
	AssetData,
	AssetMetadata,
	ListingData,
	ListingUpdateData,
	ReviewData,
	StoreProvider,
} from "@/providers/store-provider";
import { createLogger } from "@/utils/logger";
import { createAppStoreClient } from "./client";
import { type AppStoreCredentials, isMockCredentials } from "./types";

const log = createLogger("app-store");

export class AppStoreProvider implements StoreProvider {
	private readonly isMock: boolean;

	constructor(private readonly credentials: AppStoreCredentials) {
		this.isMock = isMockCredentials(credentials);
		if (this.isMock) {
			log.info("App Store provider initialized in mock mode");
		}
	}

	async validateCredentials(): Promise<boolean> {
		if (this.isMock) return true;
		try {
			const { readAll } = await createAppStoreClient(this.credentials);
			const { data } = await readAll("apps", { params: { limit: 1 } });
			log.info({ appCount: data?.length ?? 0 }, "Credentials validated");
			return true;
		} catch (err) {
			log.error({ err }, "App Store credentials validation failed");
			return false;
		}
	}

	async fetchApps(): Promise<AppData[]> {
		if (this.isMock) return MOCK_IOS_APPS;

		const { readAll } = await createAppStoreClient(this.credentials);
		const { data: appsData } = await readAll("apps");

		const apps: AppData[] = (appsData ?? []).map((raw) => {
			const app = raw as { attributes: { bundleId: string; name: string }; id: string };
			return {
				bundleId: app.attributes.bundleId,
				externalId: app.id,
				name: app.attributes.name,
				platform: "ios" as const,
			};
		});

		log.info({ count: apps.length }, "Fetched apps from App Store Connect");
		return apps;
	}

	async fetchListings(appId: string): Promise<ListingData[]> {
		if (this.isMock) return getMockListings(appId);
		// TODO: implement via appInfoLocalizations
		log.warn("Real App Store fetchListings not yet implemented — using mock");
		return getMockListings(appId);
	}

	async updateListing(
		appId: string,
		language: string,
		_data: ListingUpdateData,
	): Promise<void> {
		log.info({ appId, language }, "Mock: listing updated");
	}

	async publishListings(appId: string): Promise<void> {
		log.info({ appId }, "Mock: listings published");
	}

	async fetchAssets(appId: string, language: string): Promise<AssetData[]> {
		if (this.isMock) return getMockAssets(appId, language);
		log.warn("Real App Store fetchAssets not yet implemented — using mock");
		return getMockAssets(appId, language);
	}

	async uploadAsset(
		_appId: string,
		_language: string,
		_file: Buffer,
		metadata: AssetMetadata,
	): Promise<AssetData> {
		return {
			assetType: metadata.assetType,
			deviceType: metadata.deviceType,
			externalId: `mock-${Date.now()}`,
			url: "https://placehold.co/1080x1920?text=uploaded",
		};
	}

	async deleteAsset(appId: string, assetId: string): Promise<void> {
		log.info({ appId, assetId }, "Mock: asset deleted");
	}

	async fetchReviews(appId: string): Promise<ReviewData[]> {
		if (this.isMock) return getMockReviews(appId, "app_store");
		log.warn("Real App Store fetchReviews not yet implemented — using mock");
		return getMockReviews(appId, "app_store");
	}

	async replyToReview(
		appId: string,
		reviewId: string,
		_text: string,
	): Promise<void> {
		log.info({ appId, reviewId }, "Mock: review reply sent");
	}
}

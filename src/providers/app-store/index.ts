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
		log.warn("Real App Store credentials validation not implemented");
		return false;
	}

	async fetchApps(): Promise<AppData[]> {
		if (this.isMock) return MOCK_IOS_APPS;
		log.warn("Real App Store fetchApps not implemented");
		return [];
	}

	async fetchListings(appId: string): Promise<ListingData[]> {
		if (this.isMock) return getMockListings(appId);
		log.warn("Real App Store fetchListings not implemented");
		return [];
	}

	async updateListing(
		appId: string,
		language: string,
		data: ListingUpdateData,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId, language }, "Mock: listing updated");
			return;
		}
		log.warn("Real App Store updateListing not implemented");
	}

	async publishListings(appId: string): Promise<void> {
		if (this.isMock) {
			log.info({ appId }, "Mock: listings published");
			return;
		}
		log.warn("Real App Store publishListings not implemented");
	}

	async fetchAssets(appId: string, language: string): Promise<AssetData[]> {
		if (this.isMock) return getMockAssets(appId, language);
		log.warn("Real App Store fetchAssets not implemented");
		return [];
	}

	async uploadAsset(
		appId: string,
		language: string,
		_file: Buffer,
		metadata: AssetMetadata,
	): Promise<AssetData> {
		if (this.isMock) {
			return {
				assetType: metadata.assetType,
				deviceType: metadata.deviceType,
				externalId: `mock-${Date.now()}`,
				url: `https://placehold.co/1080x1920?text=uploaded`,
			};
		}
		throw new Error("Real App Store uploadAsset not implemented");
	}

	async deleteAsset(appId: string, assetId: string): Promise<void> {
		if (this.isMock) {
			log.info({ appId, assetId }, "Mock: asset deleted");
			return;
		}
		log.warn("Real App Store deleteAsset not implemented");
	}

	async fetchReviews(appId: string): Promise<ReviewData[]> {
		if (this.isMock) return getMockReviews(appId, "app_store");
		log.warn("Real App Store fetchReviews not implemented");
		return [];
	}

	async replyToReview(
		appId: string,
		reviewId: string,
		text: string,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId, reviewId }, "Mock: review reply sent");
			return;
		}
		log.warn("Real App Store replyToReview not implemented");
	}
}

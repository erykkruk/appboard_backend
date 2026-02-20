import {
	getMockAssets,
	getMockListings,
	getMockReviews,
	MOCK_ANDROID_APPS,
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
import { type GooglePlayCredentials, isMockCredentials } from "./types";

const log = createLogger("google-play");

export class GooglePlayProvider implements StoreProvider {
	private readonly isMock: boolean;

	constructor(readonly credentials: GooglePlayCredentials) {
		this.isMock = isMockCredentials(credentials);
		if (this.isMock) {
			log.info("Google Play provider initialized in mock mode");
		}
	}

	async validateCredentials(): Promise<boolean> {
		if (this.isMock) return true;
		// Real implementation would validate service account JSON
		log.warn("Real Google Play credentials validation not implemented");
		return false;
	}

	async fetchApps(): Promise<AppData[]> {
		if (this.isMock) return MOCK_ANDROID_APPS;
		log.warn("Real Google Play fetchApps not implemented");
		return [];
	}

	async fetchListings(appId: string): Promise<ListingData[]> {
		if (this.isMock) return getMockListings(appId);
		log.warn("Real Google Play fetchListings not implemented");
		return [];
	}

	async updateListing(
		appId: string,
		language: string,
		_data: ListingUpdateData,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId, language }, "Mock: listing updated");
			return;
		}
		log.warn("Real Google Play updateListing not implemented");
	}

	async publishListings(appId: string): Promise<void> {
		if (this.isMock) {
			log.info({ appId }, "Mock: listings published");
			return;
		}
		log.warn("Real Google Play publishListings not implemented");
	}

	async fetchAssets(appId: string, language: string): Promise<AssetData[]> {
		if (this.isMock) return getMockAssets(appId, language);
		log.warn("Real Google Play fetchAssets not implemented");
		return [];
	}

	async uploadAsset(
		_appId: string,
		_language: string,
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
		throw new Error("Real Google Play uploadAsset not implemented");
	}

	async deleteAsset(appId: string, assetId: string): Promise<void> {
		if (this.isMock) {
			log.info({ appId, assetId }, "Mock: asset deleted");
			return;
		}
		log.warn("Real Google Play deleteAsset not implemented");
	}

	async fetchReviews(appId: string): Promise<ReviewData[]> {
		if (this.isMock) return getMockReviews(appId, "google_play");
		log.warn("Real Google Play fetchReviews not implemented");
		return [];
	}

	async replyToReview(
		appId: string,
		reviewId: string,
		_text: string,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId, reviewId }, "Mock: review reply sent");
			return;
		}
		log.warn("Real Google Play replyToReview not implemented");
	}
}

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
		if (!this.isMock) {
			log.warn("Real Google Play API not yet implemented — using demo data");
		}
		return true;
	}

	async fetchApps(): Promise<AppData[]> {
		return MOCK_ANDROID_APPS;
	}

	async fetchListings(appId: string): Promise<ListingData[]> {
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
		return getMockReviews(appId, "google_play");
	}

	async replyToReview(
		appId: string,
		reviewId: string,
		_text: string,
	): Promise<void> {
		log.info({ appId, reviewId }, "Mock: review reply sent");
	}
}

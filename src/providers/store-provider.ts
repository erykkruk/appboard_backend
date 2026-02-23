export interface VersionData {
	isEditable: boolean;
	state: string;
	versionString: string;
}

export interface StoreProvider {
	validateCredentials(): Promise<boolean>;
	fetchApps(): Promise<AppData[]>;
	fetchListings(appId: string): Promise<ListingData[]>;
	updateListing(
		appId: string,
		language: string,
		data: ListingUpdateData,
	): Promise<void>;
	publishListings(appId: string): Promise<void>;
	fetchAssets(appId: string, language: string): Promise<AssetData[]>;
	uploadAsset(
		appId: string,
		language: string,
		file: Buffer,
		metadata: AssetMetadata,
	): Promise<AssetData>;
	deleteAsset(appId: string, assetId: string): Promise<void>;
	fetchReviews(appId: string): Promise<ReviewData[]>;
	replyToReview(appId: string, reviewId: string, text: string): Promise<void>;
	createVersion(
		appId: string,
		versionString: string,
	): Promise<{ state: string; versionString: string }>;
	getLatestVersion(appId: string): Promise<VersionData | null>;
	updateAgeRating(
		appId: string,
		appleQuestionnaire: Record<string, string>,
	): Promise<void>;
}

export interface AppData {
	bundleId: string;
	externalId: string;
	iconUrl?: string;
	name: string;
	platform: "android" | "ios";
}

export interface ListingData {
	fullDesc: string;
	keywords?: string;
	language: string;
	marketingUrl?: string;
	privacyUrl?: string;
	promoText?: string;
	shortDesc: string;
	supportUrl?: string;
	title: string;
	whatsNew?: string;
}

export interface ListingUpdateData {
	fullDesc?: string;
	keywords?: string;
	marketingUrl?: string;
	privacyUrl?: string;
	promoText?: string;
	shortDesc?: string;
	supportUrl?: string;
	title?: string;
	whatsNew?: string;
}

export interface AssetData {
	assetType: string;
	deviceType: string;
	externalId: string;
	fileSize?: number;
	height?: number;
	url: string;
	width?: number;
}

export interface AssetMetadata {
	assetType: string;
	deviceType: string;
	fileName?: string;
}

export interface ReviewData {
	appVersion?: string;
	authorName: string;
	body: string;
	device?: string;
	externalId: string;
	language?: string;
	osVersion?: string;
	rating: number;
	repliedAt?: Date;
	replyText?: string;
	reviewDate: Date;
	territory?: string;
	title?: string;
}

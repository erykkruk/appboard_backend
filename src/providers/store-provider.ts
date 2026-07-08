export interface VersionData {
	isEditable: boolean;
	state: string;
	versionString: string;
}

export interface CategoryData {
	primaryCategory: string | null;
	secondaryCategory: string | null;
}

/**
 * Result of probing whether a connection's credentials actually have access to
 * a capability, by test-calling the corresponding store API.
 * - `granted`: the probe call succeeded.
 * - `missing`: permission denied (401/403) — the console role was not granted.
 * - `unsupported`: not verifiable through the API key (e.g. Play Console-only).
 * - `unknown`: could not be probed (e.g. no app/package to test against).
 * - `error`: the probe failed for a non-permission reason (network, etc.).
 */
export type CapabilityAccessStatus =
	| "granted"
	| "missing"
	| "unsupported"
	| "unknown"
	| "error";

export interface CapabilityAccessResult {
	capability: string;
	status: CapabilityAccessStatus;
	detail?: string;
}

export interface StoreProvider {
	/**
	 * Verify the stored credentials against the live store API. On failure the
	 * human-readable reason is returned so it can be surfaced to the user
	 * (wrong key, missing permission, expired token…) instead of a generic
	 * "invalid credentials".
	 */
	validateCredentials(): Promise<{ reason?: string; valid: boolean }>;
	fetchApps(): Promise<AppData[]>;
	fetchListings(appId: string): Promise<ListingData[]>;
	updateListing(
		appId: string,
		language: string,
		data: ListingUpdateData,
	): Promise<void>;
	publishListings(appId: string): Promise<void>;
	batchPublishListings?(
		appId: string,
		updates: Array<{ language: string; data: ListingUpdateData }>,
	): Promise<void>;
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
	): Promise<{ state: string; versionId?: string; versionString: string }>;
	getLatestVersion(appId: string): Promise<VersionData | null>;
	updateAgeRating(
		appId: string,
		appleQuestionnaire: Record<string, string>,
	): Promise<void>;
	fetchCategories(appId: string): Promise<CategoryData>;
	updateCategories(
		appId: string,
		primaryCategory: string,
		secondaryCategory?: string,
	): Promise<void>;
	updatePrivacyDeclaration(
		appId: string,
		data: PrivacyDeclarationData,
	): Promise<void>;
	fetchInAppPurchases(appId: string): Promise<InAppPurchaseData[]>;
	fetchSubscriptionGroups(appId: string): Promise<SubscriptionGroupData[]>;
	createInAppPurchase(
		appId: string,
		data: InAppPurchaseCreateData,
	): Promise<InAppPurchaseData>;
	updateInAppPurchase(
		appId: string,
		externalId: string,
		data: InAppPurchaseUpdateData,
	): Promise<void>;
	deleteInAppPurchase(appId: string, externalId: string): Promise<void>;
	createSubscriptionGroup(
		appId: string,
		name: string,
	): Promise<SubscriptionGroupData>;
	updateSubscriptionGroup(
		appId: string,
		groupExternalId: string,
		name: string,
	): Promise<void>;
	createSubscription(
		appId: string,
		groupExternalId: string,
		data: SubscriptionCreateData,
	): Promise<InAppPurchaseData>;
	updateSubscription(
		appId: string,
		subExternalId: string,
		data: SubscriptionUpdateData,
	): Promise<void>;
	deleteSubscription(appId: string, subExternalId: string): Promise<void>;
	deleteSubscriptionGroup(
		appId: string,
		groupExternalId: string,
	): Promise<void>;

	// Optional: Price push
	updateIapPrices?(
		iapExternalId: string,
		prices: PurchasePriceData[],
	): Promise<void>;
	updateSubscriptionPrices?(
		subExternalId: string,
		prices: PurchasePriceData[],
	): Promise<void>;

	// Optional: Availability
	fetchSubscriptionAvailability?(
		subscriptionExternalId: string,
	): Promise<string[]>;
	updateSubscriptionAvailability?(
		subscriptionExternalId: string,
		territories: string[],
	): Promise<void>;

	// Optional: Family sharing
	updateFamilySharing?(
		subscriptionExternalId: string,
		familySharable: boolean,
	): Promise<void>;

	// Optional: Group localizations
	fetchGroupLocalizations?(
		groupExternalId: string,
	): Promise<PurchaseLocalizationData[]>;
	createGroupLocalization?(
		groupExternalId: string,
		language: string,
		data: { name: string },
	): Promise<{ externalId: string }>;
	updateGroupLocalization?(
		localizationExternalId: string,
		data: { name: string },
	): Promise<void>;
	deleteGroupLocalization?(localizationExternalId: string): Promise<void>;

	checkMonetizationSupport(
		appId: string,
	): Promise<{ reason?: string; supported: boolean }>;

	/**
	 * Probe which capabilities the credentials actually have access to by
	 * test-calling the corresponding store APIs. Used to show the user, right
	 * after they enter a key, what they can and cannot do with it.
	 */
	verifyCapabilityAccess?(): Promise<CapabilityAccessResult[]>;
}

export interface AppData {
	bundleId: string;
	externalId: string;
	iconUrl?: string;
	isDraft?: boolean;
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
	videoUrl?: string;
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
	videoUrl?: string;
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

export interface PrivacyDeclarationData {
	dataCollections: Array<{
		category: string;
		collected?: boolean;
		dataType: string;
		ephemeral?: boolean;
		linked: boolean;
		purposes: string[];
		required?: boolean;
		shared?: boolean;
		tracking: boolean;
	}>;
	gpDeletionMechanism: boolean;
	gpEncryptedInTransit: boolean;
	privacyPolicyUrl: string | null;
	trackingDomains: string[] | null;
	trackingEnabled: boolean;
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

export interface SubscriptionGroupData {
	externalId: string;
	name: string;
	subscriptions: InAppPurchaseData[];
}

export interface InAppPurchaseData {
	duration?: string;
	externalId: string;
	familySharable?: boolean;
	groupExternalId?: string;
	localizations?: PurchaseLocalizationData[];
	name: string;
	prices?: PurchasePriceData[];
	productId: string;
	productType: string;
	status: string;
}

export interface PurchaseLocalizationData {
	description?: string;
	externalId?: string;
	language: string;
	name?: string;
}

export interface PurchasePriceData {
	currency: string;
	externalId?: string;
	price: string;
	pricePointId?: string;
	territory: string;
}

export interface InAppPurchaseCreateData {
	localizations?: PurchaseLocalizationData[];
	name: string;
	prices?: PurchasePriceData[];
	productId: string;
	productType: string;
}

export interface InAppPurchaseUpdateData {
	localizations?: PurchaseLocalizationData[];
	name?: string;
	prices?: PurchasePriceData[];
}

export interface SubscriptionCreateData {
	duration: string;
	localizations?: PurchaseLocalizationData[];
	name: string;
	prices?: PurchasePriceData[];
	productId: string;
}

export interface SubscriptionUpdateData {
	localizations?: PurchaseLocalizationData[];
	name?: string;
	prices?: PurchasePriceData[];
}

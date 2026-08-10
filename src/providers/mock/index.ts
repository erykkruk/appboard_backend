import type { StoreType } from "@/config/const";
import { STORE_TYPE_LABELS } from "@/config/const";
import {
	getMockAssets,
	getMockInAppPurchases,
	getMockListings,
	getMockReviews,
	getMockSubscriptionGroups,
	MOCK_ANDROID_APPS,
} from "@/providers/mock-data";
import type {
	AppData,
	AssetData,
	AssetMetadata,
	CategoryData,
	InAppPurchaseCreateData,
	InAppPurchaseData,
	InAppPurchaseUpdateData,
	ListingData,
	ListingUpdateData,
	PrivacyDeclarationData,
	ReviewData,
	StoreProvider,
	SubscriptionCreateData,
	SubscriptionGroupData,
	SubscriptionUpdateData,
	VersionData,
} from "@/providers/store-provider";
import { createLogger } from "@/utils/logger";

const log = createLogger("mock-provider");

/**
 * Generic provider for alternative app stores (Huawei AppGallery, Amazon
 * Appstore, Samsung Galaxy Store, …) that don't yet have a real API integration.
 *
 * It returns believable mock data for read paths so the whole app works end to
 * end behind the MULTI_STORE feature flag, and no-ops write paths (there is no
 * live store to publish to yet). When a real integration lands, swap the mapping
 * in `createProvider` from this stub to the concrete client.
 */
export class MockStoreProvider implements StoreProvider {
	private readonly label: string;

	constructor(
		private readonly storeType: StoreType,
		_credentials: Record<string, unknown>,
	) {
		this.label = STORE_TYPE_LABELS[storeType] ?? storeType;
	}

	async validateCredentials(): Promise<{ reason?: string; valid: boolean }> {
		log.info(
			{ storeType: this.storeType },
			`${this.label} provider (stub) connected`,
		);
		return { valid: true };
	}

	async fetchApps(): Promise<AppData[]> {
		// Give each store its own namespace so apps don't collide across stores.
		const prefix = this.storeType;
		return MOCK_ANDROID_APPS.map((app) => ({
			...app,
			bundleId: app.bundleId,
			externalId: `${prefix}:${app.externalId}`,
		}));
	}

	async fetchListings(appId: string): Promise<ListingData[]> {
		return getMockListings(this.baseId(appId));
	}

	async fetchAssets(appId: string, language: string): Promise<AssetData[]> {
		return getMockAssets(this.baseId(appId), language);
	}

	async fetchReviews(appId: string): Promise<ReviewData[]> {
		return getMockReviews(this.baseId(appId), this.storeType);
	}

	async fetchInAppPurchases(appId: string): Promise<InAppPurchaseData[]> {
		return getMockInAppPurchases(this.baseId(appId));
	}

	async fetchSubscriptionGroups(
		appId: string,
	): Promise<SubscriptionGroupData[]> {
		return getMockSubscriptionGroups(this.baseId(appId));
	}

	async getLatestVersion(_appId: string): Promise<VersionData | null> {
		return { isEditable: true, state: "DRAFT", versionString: "1.0.0" };
	}

	async fetchCategories(_appId: string): Promise<CategoryData> {
		return { primaryCategory: null, secondaryCategory: null };
	}

	async checkMonetizationSupport(
		_appId: string,
	): Promise<{ reason?: string; supported: boolean }> {
		return {
			reason: `${this.label} monetization is not available yet.`,
			supported: false,
		};
	}

	// ── Write paths — no-ops until a real integration exists ────────────────
	async updateListing(
		_appId: string,
		_language: string,
		_data: ListingUpdateData,
	): Promise<void> {}

	async publishListings(_appId: string): Promise<void> {}

	async uploadAsset(
		_appId: string,
		_language: string,
		_file: Buffer,
		metadata: AssetMetadata,
	): Promise<AssetData> {
		return {
			assetType: metadata.assetType,
			deviceType: metadata.deviceType,
			externalId: `${this.storeType}-asset-${Date.now()}`,
			url: "https://placehold.co/512x512?text=Asset",
		};
	}

	async deleteAsset(_appId: string, _assetId: string): Promise<void> {}

	async replyToReview(
		_appId: string,
		_reviewId: string,
		_text: string,
	): Promise<void> {}

	async createVersion(
		_appId: string,
		versionString: string,
	): Promise<{ state: string; versionId?: string; versionString: string }> {
		return {
			state: "DRAFT",
			versionId: `${this.storeType}-ver-${Date.now()}`,
			versionString,
		};
	}

	async updateAgeRating(
		_appId: string,
		_appleQuestionnaire: Record<string, string>,
	): Promise<void> {}

	async updateCategories(
		_appId: string,
		_primary: string,
		_secondary?: string,
	): Promise<void> {}

	async updatePrivacyDeclaration(
		_appId: string,
		_data: PrivacyDeclarationData,
	): Promise<void> {}

	async createInAppPurchase(
		_appId: string,
		data: InAppPurchaseCreateData,
	): Promise<InAppPurchaseData> {
		return {
			externalId: `${this.storeType}-iap-${Date.now()}`,
			name: data.name,
			productId: data.productId,
			productType: data.productType,
			status: "draft",
		};
	}

	async updateInAppPurchase(
		_appId: string,
		_externalId: string,
		_data: InAppPurchaseUpdateData,
	): Promise<void> {}

	async deleteInAppPurchase(
		_appId: string,
		_externalId: string,
	): Promise<void> {}

	async createSubscriptionGroup(
		_appId: string,
		name: string,
	): Promise<SubscriptionGroupData> {
		return {
			externalId: `${this.storeType}-group-${Date.now()}`,
			name,
			subscriptions: [],
		};
	}

	async updateSubscriptionGroup(
		_appId: string,
		_groupExternalId: string,
		_name: string,
	): Promise<void> {}

	async createSubscription(
		_appId: string,
		groupExternalId: string,
		data: SubscriptionCreateData,
	): Promise<InAppPurchaseData> {
		return {
			externalId: `${this.storeType}-sub-${Date.now()}`,
			groupExternalId,
			name: data.name,
			productId: data.productId,
			productType: "auto_renewable",
			status: "draft",
		};
	}

	async updateSubscription(
		_appId: string,
		_subExternalId: string,
		_data: SubscriptionUpdateData,
	): Promise<void> {}

	async deleteSubscription(
		_appId: string,
		_subExternalId: string,
	): Promise<void> {}

	async deleteSubscriptionGroup(
		_appId: string,
		_groupExternalId: string,
	): Promise<void> {}

	private baseId(appId: string): string {
		const marker = `${this.storeType}:`;
		return appId.startsWith(marker) ? appId.slice(marker.length) : appId;
	}
}

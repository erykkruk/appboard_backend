import {
	DEFAULT_PUBLIC_COUNTRY,
	STORE_TYPE_LABELS,
	type StoreType,
} from "@/config/const";
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
import { buildError } from "@/utils/errors";

/**
 * Context a public (credential-less) provider works with. `externalIds` feeds
 * `fetchApps()` only — the apps table is the source of truth for which apps a
 * public connection tracks, so the caller passes their ids in. Every per-app
 * method receives the external id as its parameter, like any other provider.
 */
export interface PublicProviderContext {
	country?: string;
	externalIds?: string[];
}

/**
 * Shared base for public store connections — apps added from a store link
 * without API credentials. Reads are served from public store surfaces
 * (iTunes lookup, Play scraping); every write raises a typed 403
 * INTEGRATION_REQUIRED so the panel can offer the "connect your store API"
 * upgrade instead of a silent failure or a 500.
 */
export abstract class PublicStoreProvider implements StoreProvider {
	protected readonly label: string;
	protected readonly country: string;
	protected readonly externalIds: string[];

	protected constructor(storeType: StoreType, context: PublicProviderContext) {
		this.label = STORE_TYPE_LABELS[storeType] ?? storeType;
		this.country = context.country ?? DEFAULT_PUBLIC_COUNTRY;
		this.externalIds = context.externalIds ?? [];
	}

	protected integrationRequired(action: string): never {
		buildError("integrationRequired", {
			info: `This app was added from a public store link, so AppBoard cannot ${action}. Connect your ${this.label} API to unlock it.`,
		});
	}

	async validateCredentials(): Promise<{ reason?: string; valid: boolean }> {
		return { valid: true };
	}

	abstract fetchApps(): Promise<AppData[]>;

	abstract fetchListings(appId: string): Promise<ListingData[]>;

	abstract fetchAssets(appId: string, language: string): Promise<AssetData[]>;

	abstract fetchReviews(appId: string): Promise<ReviewData[]>;

	abstract fetchCategories(appId: string): Promise<CategoryData>;

	updateListing(
		_appId: string,
		_language: string,
		_data: ListingUpdateData,
	): Promise<void> {
		return this.integrationRequired("edit the store listing");
	}

	publishListings(_appId: string): Promise<void> {
		return this.integrationRequired("publish listing changes");
	}

	uploadAsset(
		_appId: string,
		_language: string,
		_file: Buffer,
		_metadata: AssetMetadata,
	): Promise<AssetData> {
		return this.integrationRequired("upload screenshots");
	}

	deleteAsset(_appId: string, _assetId: string): Promise<void> {
		return this.integrationRequired("delete screenshots");
	}

	replyToReview(
		_appId: string,
		_reviewId: string,
		_text: string,
	): Promise<void> {
		return this.integrationRequired("reply to reviews");
	}

	createVersion(
		_appId: string,
		_versionString: string,
	): Promise<{ state: string; versionId?: string; versionString: string }> {
		return this.integrationRequired("create app versions");
	}

	updateAgeRating(
		_appId: string,
		_appleQuestionnaire: Record<string, string>,
	): Promise<void> {
		return this.integrationRequired("edit the age rating");
	}

	updateCategories(
		_appId: string,
		_primaryCategory: string,
		_secondaryCategory?: string,
	): Promise<void> {
		return this.integrationRequired("edit categories");
	}

	updatePrivacyDeclaration(
		_appId: string,
		_data: PrivacyDeclarationData,
	): Promise<void> {
		return this.integrationRequired("edit the privacy declaration");
	}

	fetchInAppPurchases(_appId: string): Promise<InAppPurchaseData[]> {
		return this.integrationRequired("read in-app purchases");
	}

	fetchSubscriptionGroups(_appId: string): Promise<SubscriptionGroupData[]> {
		return this.integrationRequired("read subscriptions");
	}

	createInAppPurchase(
		_appId: string,
		_data: InAppPurchaseCreateData,
	): Promise<InAppPurchaseData> {
		return this.integrationRequired("create in-app purchases");
	}

	updateInAppPurchase(
		_appId: string,
		_externalId: string,
		_data: InAppPurchaseUpdateData,
	): Promise<void> {
		return this.integrationRequired("edit in-app purchases");
	}

	deleteInAppPurchase(_appId: string, _externalId: string): Promise<void> {
		return this.integrationRequired("delete in-app purchases");
	}

	createSubscriptionGroup(
		_appId: string,
		_name: string,
	): Promise<SubscriptionGroupData> {
		return this.integrationRequired("create subscription groups");
	}

	updateSubscriptionGroup(
		_appId: string,
		_groupExternalId: string,
		_name: string,
	): Promise<void> {
		return this.integrationRequired("edit subscription groups");
	}

	createSubscription(
		_appId: string,
		_groupExternalId: string,
		_data: SubscriptionCreateData,
	): Promise<InAppPurchaseData> {
		return this.integrationRequired("create subscriptions");
	}

	updateSubscription(
		_appId: string,
		_subExternalId: string,
		_data: SubscriptionUpdateData,
	): Promise<void> {
		return this.integrationRequired("edit subscriptions");
	}

	deleteSubscription(_appId: string, _subExternalId: string): Promise<void> {
		return this.integrationRequired("delete subscriptions");
	}

	deleteSubscriptionGroup(
		_appId: string,
		_groupExternalId: string,
	): Promise<void> {
		return this.integrationRequired("delete subscription groups");
	}

	/**
	 * Read-only probes the panel calls to decide what to render. These answer
	 * "nothing here" rather than throwing, so a public app still opens.
	 */
	async getLatestVersion(_appId: string): Promise<VersionData | null> {
		return null;
	}

	async checkMonetizationSupport(
		_appId: string,
	): Promise<{ reason?: string; supported: boolean }> {
		return {
			reason: `This app uses public store data only. Connect your ${this.label} API to manage in-app purchases.`,
			supported: false,
		};
	}
}

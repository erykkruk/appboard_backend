import { STORE_TYPE_LABELS, type StoreType } from "@/config/const";
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
 * Shared base for the alternative Android stores (Huawei AppGallery, Samsung
 * Galaxy Store, Amazon Appstore, RuStore, ONE Store, Xiaomi GetApps).
 *
 * None of these stores expose an API as broad as App Store Connect or the Play
 * Developer API — most have no reviews, monetization or age-rating endpoints at
 * all. Every method a store's API genuinely cannot perform stays on this base
 * and raises a typed 400 naming the store, instead of silently no-opping and
 * letting the user believe a change was pushed.
 *
 * Concrete providers override only what they truly implement; anything left
 * inherited is, by construction, not wired — which keeps
 * `src/config/store-capabilities.ts` honest.
 */
export abstract class AlternativeStoreProvider implements StoreProvider {
	protected readonly label: string;

	protected constructor(protected readonly storeType: StoreType) {
		this.label = STORE_TYPE_LABELS[storeType] ?? storeType;
	}

	/**
	 * Raised by every capability the store's developer API does not cover, so the
	 * panel can tell the user exactly what to do in the store console instead.
	 */
	protected unsupported(action: string): never {
		buildError("badRequest", {
			info: `${this.label} does not support ${action} through its developer API. Manage it in the ${this.label} developer console.`,
		});
	}

	abstract validateCredentials(): Promise<{ reason?: string; valid: boolean }>;

	abstract fetchApps(): Promise<AppData[]>;

	fetchListings(_appId: string): Promise<ListingData[]> {
		return this.unsupported("reading store listings");
	}

	updateListing(
		_appId: string,
		_language: string,
		_data: ListingUpdateData,
	): Promise<void> {
		return this.unsupported("editing store listings");
	}

	publishListings(_appId: string): Promise<void> {
		return this.unsupported("publishing listing changes");
	}

	fetchAssets(_appId: string, _language: string): Promise<AssetData[]> {
		return this.unsupported("reading screenshots");
	}

	uploadAsset(
		_appId: string,
		_language: string,
		_file: Buffer,
		_metadata: AssetMetadata,
	): Promise<AssetData> {
		return this.unsupported("uploading screenshots");
	}

	deleteAsset(_appId: string, _assetId: string): Promise<void> {
		return this.unsupported("deleting screenshots");
	}

	fetchReviews(_appId: string): Promise<ReviewData[]> {
		return this.unsupported("reading reviews");
	}

	replyToReview(
		_appId: string,
		_reviewId: string,
		_text: string,
	): Promise<void> {
		return this.unsupported("replying to reviews");
	}

	createVersion(
		_appId: string,
		_versionString: string,
	): Promise<{ state: string; versionId?: string; versionString: string }> {
		return this.unsupported("creating app versions");
	}

	updateAgeRating(
		_appId: string,
		_appleQuestionnaire: Record<string, string>,
	): Promise<void> {
		return this.unsupported("editing the age rating");
	}

	updateCategories(
		_appId: string,
		_primaryCategory: string,
		_secondaryCategory?: string,
	): Promise<void> {
		return this.unsupported("editing categories");
	}

	updatePrivacyDeclaration(
		_appId: string,
		_data: PrivacyDeclarationData,
	): Promise<void> {
		return this.unsupported("editing the privacy declaration");
	}

	fetchInAppPurchases(_appId: string): Promise<InAppPurchaseData[]> {
		return this.unsupported("reading in-app purchases");
	}

	fetchSubscriptionGroups(_appId: string): Promise<SubscriptionGroupData[]> {
		return this.unsupported("reading subscriptions");
	}

	createInAppPurchase(
		_appId: string,
		_data: InAppPurchaseCreateData,
	): Promise<InAppPurchaseData> {
		return this.unsupported("creating in-app purchases");
	}

	updateInAppPurchase(
		_appId: string,
		_externalId: string,
		_data: InAppPurchaseUpdateData,
	): Promise<void> {
		return this.unsupported("editing in-app purchases");
	}

	deleteInAppPurchase(_appId: string, _externalId: string): Promise<void> {
		return this.unsupported("deleting in-app purchases");
	}

	createSubscriptionGroup(
		_appId: string,
		_name: string,
	): Promise<SubscriptionGroupData> {
		return this.unsupported("creating subscription groups");
	}

	updateSubscriptionGroup(
		_appId: string,
		_groupExternalId: string,
		_name: string,
	): Promise<void> {
		return this.unsupported("editing subscription groups");
	}

	createSubscription(
		_appId: string,
		_groupExternalId: string,
		_data: SubscriptionCreateData,
	): Promise<InAppPurchaseData> {
		return this.unsupported("creating subscriptions");
	}

	updateSubscription(
		_appId: string,
		_subExternalId: string,
		_data: SubscriptionUpdateData,
	): Promise<void> {
		return this.unsupported("editing subscriptions");
	}

	deleteSubscription(_appId: string, _subExternalId: string): Promise<void> {
		return this.unsupported("deleting subscriptions");
	}

	deleteSubscriptionGroup(
		_appId: string,
		_groupExternalId: string,
	): Promise<void> {
		return this.unsupported("deleting subscription groups");
	}

	/**
	 * Read-only probes the panel calls to decide what to render. These answer
	 * "nothing here" rather than throwing, so a connected store still opens.
	 */
	async getLatestVersion(_appId: string): Promise<VersionData | null> {
		return null;
	}

	async fetchCategories(_appId: string): Promise<CategoryData> {
		return { primaryCategory: null, secondaryCategory: null };
	}

	async checkMonetizationSupport(
		_appId: string,
	): Promise<{ reason?: string; supported: boolean }> {
		return {
			reason: `${this.label} does not expose an in-app purchase API.`,
			supported: false,
		};
	}
}

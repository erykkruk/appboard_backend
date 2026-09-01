import {
	appstoreMeta,
	appstoreReviews,
} from "@/modules/research/appstore.client";
import { langFor } from "@/modules/research/playstore.client";
import type {
	AppData,
	AssetData,
	CategoryData,
	ListingData,
	ReviewData,
} from "@/providers/store-provider";
import { createLogger } from "@/utils/logger";
import { type PublicProviderContext, PublicStoreProvider } from "./base";
import { splitGenres, toReviewData, toScreenshotAssets } from "./shared";

const log = createLogger("public-app-store");

/**
 * Credential-less App Store connection backed by the public iTunes Lookup API
 * (the same client the research module uses). External ids are the numeric
 * Apple app ids — identical to App Store Connect ids, so a later real API
 * connection re-binds these apps seamlessly.
 */
export class PublicAppStoreProvider extends PublicStoreProvider {
	constructor(context: PublicProviderContext = {}) {
		super("app_store", context);
	}

	async fetchApps(): Promise<AppData[]> {
		const results: AppData[] = [];
		for (const id of this.externalIds) {
			try {
				const meta = await appstoreMeta(id, this.country);
				results.push({
					bundleId: meta.bundleId ?? id,
					externalId: id,
					iconUrl: meta.icon,
					name: meta.title,
					platform: "ios",
				});
			} catch (err) {
				// One unavailable app must not sink the whole refresh.
				log.warn({ err, id }, "Public App Store app refresh failed");
			}
		}
		return results;
	}

	async fetchListings(appId: string): Promise<ListingData[]> {
		const meta = await appstoreMeta(appId, this.country);
		return [
			{
				fullDesc: meta.description ?? "",
				language: langFor(this.country),
				// The iTunes Lookup API does not expose the subtitle.
				shortDesc: "",
				title: meta.title,
				...(meta.releaseNotes ? { whatsNew: meta.releaseNotes } : {}),
			},
		];
	}

	async fetchAssets(appId: string, _language: string): Promise<AssetData[]> {
		const meta = await appstoreMeta(appId, this.country);
		return toScreenshotAssets(meta.screenshots ?? []);
	}

	async fetchReviews(appId: string): Promise<ReviewData[]> {
		const reviews = await appstoreReviews(appId, this.country);
		return reviews.map((r) => toReviewData(r, "App Store user"));
	}

	async fetchCategories(appId: string): Promise<CategoryData> {
		const meta = await appstoreMeta(appId, this.country);
		return splitGenres(meta.genre);
	}
}

import {
	langFor,
	playstoreMeta,
	playstoreReviews,
} from "@/modules/research/playstore.client";
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

const log = createLogger("public-google-play");

/**
 * Credential-less Google Play connection backed by public Play listing data
 * (google-play-scraper, same client the research module uses). External ids
 * are package names — identical to Play Developer API ids, so a later real
 * API connection re-binds these apps seamlessly.
 */
export class PublicGooglePlayProvider extends PublicStoreProvider {
	constructor(context: PublicProviderContext = {}) {
		super("google_play", context);
	}

	async fetchApps(): Promise<AppData[]> {
		const results: AppData[] = [];
		for (const id of this.externalIds) {
			try {
				const meta = await playstoreMeta(id, this.country);
				results.push({
					bundleId: id,
					externalId: id,
					iconUrl: meta.icon,
					name: meta.title,
					platform: "android",
				});
			} catch (err) {
				// One unavailable app must not sink the whole refresh.
				log.warn({ err, id }, "Public Google Play app refresh failed");
			}
		}
		return results;
	}

	async fetchListings(appId: string): Promise<ListingData[]> {
		const meta = await playstoreMeta(appId, this.country);
		return [
			{
				fullDesc: meta.description ?? "",
				language: langFor(this.country),
				shortDesc: meta.summary ?? "",
				title: meta.title,
				...(meta.releaseNotes ? { whatsNew: meta.releaseNotes } : {}),
			},
		];
	}

	async fetchAssets(appId: string, _language: string): Promise<AssetData[]> {
		const meta = await playstoreMeta(appId, this.country);
		return toScreenshotAssets(meta.screenshots ?? []);
	}

	async fetchReviews(appId: string): Promise<ReviewData[]> {
		const reviews = await playstoreReviews(appId, this.country);
		return reviews.map((r) => toReviewData(r, "Google Play user"));
	}

	async fetchCategories(appId: string): Promise<CategoryData> {
		const meta = await playstoreMeta(appId, this.country);
		return splitGenres(meta.genre);
	}
}

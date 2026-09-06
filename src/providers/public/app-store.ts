import {
	appStoreLocale,
	appstoreMeta,
	appstoreReviews,
	isoForListingLanguage,
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
import {
	splitGenres,
	storeFactsFrom,
	toReviewData,
	toScreenshotAssets,
} from "./shared";

/**
 * Storefronts worth reading reviews from, by listing language. Apple keeps
 * reviews per storefront, so an app sold in four languages has four separate
 * review lists - reading only the import country silently hides the rest.
 */
const STOREFRONTS_BY_LANGUAGE: Record<string, string[]> = {
	DE: ["de", "at", "ch"],
	EN: ["us", "gb", "au", "ca"],
	ES: ["es", "mx"],
	FR: ["fr"],
	IT: ["it"],
	JA: ["jp"],
	KO: ["kr"],
	NL: ["nl"],
	PL: ["pl"],
	PT: ["br", "pt"],
	RU: ["ru"],
	SV: ["se"],
	TR: ["tr"],
	ZH: ["cn", "tw"],
};
/** Hard cap on live review calls per app sync. */
const MAX_REVIEW_STOREFRONTS = 8;

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
					storeFacts: storeFactsFrom(meta),
				});
			} catch (err) {
				// One unavailable app must not sink the whole refresh.
				log.warn({ err, id }, "Public App Store app refresh failed");
			}
		}
		return results;
	}

	/**
	 * Every localization the store actually serves, not just one. The Lookup
	 * API returns localized title, description and screenshots when asked with
	 * `l`, and `languageCodesISO2A` says which languages exist. A language
	 * whose text comes back identical to the default is a fallback, not a
	 * localization, so it is skipped rather than stored as a duplicate.
	 */
	async fetchListings(appId: string): Promise<ListingData[]> {
		const base = await appstoreMeta(appId, this.country);
		const primary: ListingData = {
			fullDesc: base.description ?? "",
			language: langFor(this.country),
			// The iTunes Lookup API does not expose the subtitle.
			shortDesc: "",
			title: base.title,
			...(base.releaseNotes ? { whatsNew: base.releaseNotes } : {}),
		};

		const declared = (base.languages ?? [])
			.map((iso) => ({ iso, locale: appStoreLocale(iso) }))
			.filter(
				(
					entry,
				): entry is {
					iso: string;
					locale: NonNullable<ReturnType<typeof appStoreLocale>>;
				} => entry.locale !== null,
			);
		if (declared.length === 0) return [primary];

		const listings: ListingData[] = [];
		const seenText = new Set<string>();
		for (const { iso, locale } of declared) {
			try {
				const meta = await appstoreMeta(appId, this.country, iso);
				const fingerprint = `${meta.title}\u0000${meta.description ?? ""}`;
				if (seenText.has(fingerprint)) continue;
				seenText.add(fingerprint);
				listings.push({
					fullDesc: meta.description ?? "",
					language: locale.listing,
					shortDesc: "",
					title: meta.title,
					...(meta.releaseNotes ? { whatsNew: meta.releaseNotes } : {}),
				});
			} catch (err) {
				log.warn({ err, iso }, "Public App Store localization fetch failed");
			}
		}

		return listings.length > 0 ? listings : [primary];
	}

	async fetchAssets(appId: string, language: string): Promise<AssetData[]> {
		const iso = isoForListingLanguage(language);
		const meta = await appstoreMeta(appId, this.country, iso ?? undefined);
		return toScreenshotAssets(meta.screenshots ?? [], language);
	}

	/**
	 * Reviews from every storefront the app is sold in, not just the one it
	 * was imported from. Each review remembers its territory so the panel can
	 * say where it came from.
	 */
	async fetchReviews(appId: string): Promise<ReviewData[]> {
		const storefronts = new Set<string>([this.country.toLowerCase()]);
		try {
			const meta = await appstoreMeta(appId, this.country);
			for (const iso of meta.languages ?? []) {
				for (const cc of STOREFRONTS_BY_LANGUAGE[iso.toUpperCase()] ?? []) {
					if (storefronts.size >= MAX_REVIEW_STOREFRONTS) break;
					storefronts.add(cc);
				}
			}
		} catch (err) {
			log.warn(
				{ appId, err },
				"Could not list storefronts, using import country",
			);
		}

		const seen = new Set<string>();
		const all: ReviewData[] = [];
		for (const cc of storefronts) {
			let reviews: Awaited<ReturnType<typeof appstoreReviews>> = [];
			try {
				reviews = await appstoreReviews(appId, cc);
			} catch (err) {
				log.warn({ appId, cc, err }, "Public App Store reviews fetch failed");
				continue;
			}
			for (const review of reviews) {
				const data = toReviewData(review, "App Store user", cc);
				if (seen.has(data.externalId)) continue;
				seen.add(data.externalId);
				all.push(data);
			}
		}
		return all;
	}

	async fetchCategories(appId: string): Promise<CategoryData> {
		const meta = await appstoreMeta(appId, this.country);
		return splitGenres(meta.genre);
	}
}

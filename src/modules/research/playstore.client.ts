import gplay from "google-play-scraper";
import type {
	ResearchAppMeta,
	ResearchReview,
	SearchSuggestion,
} from "./research.types";

const REVIEWS_LIMIT = 250;
const REVIEWS_LIMIT_DEEP = 1500;
const REVIEW_STATS_SAMPLE = 100;
const SEARCH_LIMIT = 50;
const MAX_COMPETITORS = 8;
const MAX_SCREENSHOTS = 6;
const NEGATIVE_MAX_STARS = 3;
const DEVELOPER_PREFIX_LEN = 15;
// The package typings expose the sort enum as a value — 2 === sort.NEWEST
const SORT_NEWEST = 2;

const LANG_FOR: Record<string, string> = {
	de: "de",
	es: "es",
	fr: "fr",
	gb: "en",
	it: "it",
	pl: "pl",
	us: "en",
};

export function langFor(country: string): string {
	return LANG_FOR[country] ?? "en";
}

export async function playstoreMeta(
	appId: string,
	country: string,
): Promise<ResearchAppMeta> {
	const app = await gplay.app({ appId, country, lang: langFor(country) });
	return {
		adSupported: app.adSupported,
		contentRating: app.contentRating,
		country,
		description: app.description,
		developer: app.developer,
		downloads: app.installs,
		free: app.free,
		genre: app.genre,
		iapRange: app.IAPRange,
		icon: app.icon,
		id: appId,
		lastUpdate: app.updated ? new Date(app.updated).toISOString() : undefined,
		minInstalls: app.minInstalls,
		offersIAP: app.offersIAP,
		price: app.free ? "Free" : app.priceText,
		rating: app.score,
		ratingsCount: app.ratings,
		released: app.released,
		reviewsCount: app.reviews,
		screenshots: (app.screenshots ?? []).slice(0, MAX_SCREENSHOTS),
		store: "playstore",
		summary: app.summary,
		title: app.title,
		url: app.url,
		version: app.version,
	};
}

export async function playstoreSearch(
	term: string,
	country: string,
	limit: number,
): Promise<SearchSuggestion[]> {
	const results = await gplay.search({
		country,
		lang: langFor(country),
		num: limit,
		term,
	});
	return results.map((r) => ({
		developer: r.developer,
		icon: r.icon,
		id: r.appId,
		rating: r.score,
		store: "playstore" as const,
		title: r.title,
		url: r.url,
	}));
}

export async function playstoreReviews(
	appId: string,
	country: string,
	deep = false,
): Promise<ResearchReview[]> {
	const result = await gplay.reviews({
		appId,
		country,
		lang: langFor(country),
		num: deep ? REVIEWS_LIMIT_DEEP : REVIEWS_LIMIT,
		sort: SORT_NEWEST,
	});
	return result.data
		.filter((r) => r.text)
		.map((r) => ({
			date: r.date ?? undefined,
			stars: r.score ?? 0,
			store: "playstore" as const,
			text: r.text as string,
			title: r.title ?? undefined,
			version: r.version ?? undefined,
		}));
}

export async function playstoreSearchPosition(
	keyword: string,
	appId: string,
	country: string,
): Promise<number | null> {
	const results = await gplay.search({
		country,
		lang: langFor(country),
		num: SEARCH_LIMIT,
		term: keyword,
	});
	const idx = results.findIndex((r) => r.appId === appId);
	return idx >= 0 ? idx + 1 : null;
}

function sameDeveloper(a: string, b: string): boolean {
	const na = a.toLowerCase().trim();
	const nb = b.toLowerCase().trim();
	return (
		na.startsWith(nb.slice(0, DEVELOPER_PREFIX_LEN)) ||
		nb.startsWith(na.slice(0, DEVELOPER_PREFIX_LEN))
	);
}

export async function playstoreSimilar(
	appId: string,
	country: string,
	excludeDeveloper?: string,
): Promise<SearchSuggestion[]> {
	const results = await gplay.similar({
		appId,
		country,
		lang: langFor(country),
	});
	return results
		.filter(
			(r) => !excludeDeveloper || !sameDeveloper(r.developer, excludeDeveloper),
		)
		.slice(0, MAX_COMPETITORS)
		.map((r) => ({
			developer: r.developer,
			icon: r.icon,
			id: r.appId,
			rating: r.score,
			store: "playstore" as const,
			title: r.title,
			url: r.url,
		}));
}

/** Share of negative reviews + share with a developer reply (sample of 100). */
export async function playstoreReviewStats(
	appId: string,
	country: string,
): Promise<{ negativeShare?: number; devReplyRate?: number }> {
	const result = await gplay.reviews({
		appId,
		country,
		lang: langFor(country),
		num: REVIEW_STATS_SAMPLE,
		sort: SORT_NEWEST,
	});
	const rows = result.data;
	if (!rows.length)
		return { devReplyRate: undefined, negativeShare: undefined };
	return {
		devReplyRate: rows.filter((r) => r.replyText).length / rows.length,
		negativeShare:
			rows.filter((r) => (r.score ?? 0) <= NEGATIVE_MAX_STARS).length /
			rows.length,
	};
}

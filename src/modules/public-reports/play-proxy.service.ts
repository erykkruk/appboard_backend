import gplay from "google-play-scraper";
import { langFor } from "@/modules/research/playstore.client";
import type { KeywordCompetitor } from "@/modules/research/scoring-types";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("play-proxy");

// Google Play has no CORS-friendly public API, so the free browser-side
// check-up needs this thin server proxy for Play data. It is deliberately
// bounded: results are cached per keyword+country for a day (repeat
// check-ups of popular keywords cost Play nothing) and detail hydration is
// capped, so one check-up costs at most ~KEYWORD_DETAIL_COUNT requests per
// keyword on a cache miss.
const SEARCH_LIMIT = 50;
const KEYWORD_DETAIL_COUNT = 12;
const DETAIL_CONCURRENCY = 4;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2_000;

export interface PlayLookupResult {
	trackId: string;
	name: string;
	developer: string;
	icon?: string;
	rating?: number;
	ratingsCount?: number;
	description: string;
	genre: string;
	genres: string[];
	screenshots: number;
	screenshotUrls: string[];
	released?: string;
	updated?: string;
	price?: string;
	url?: string;
	country: string;
}

interface KeywordCacheEntry {
	competitors: KeywordCompetitor[];
	expiresAt: number;
	orderedIds: string[];
}

const keywordCache = new Map<string, KeywordCacheEntry>();

function cacheGet(key: string): KeywordCacheEntry | null {
	const entry = keywordCache.get(key);
	if (!entry) return null;
	if (Date.now() > entry.expiresAt) {
		keywordCache.delete(key);
		return null;
	}
	return entry;
}

function cacheSet(key: string, entry: KeywordCacheEntry): void {
	if (keywordCache.size >= CACHE_MAX_ENTRIES) {
		const oldest = keywordCache.keys().next().value;
		if (oldest) keywordCache.delete(oldest);
	}
	keywordCache.set(key, entry);
}

/** ISO-ish date from Play's human "May 5, 2015" format (best effort). */
function toIsoDate(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const parsed = new Date(raw);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export class PlayProxyService {
	static async lookup(
		appId: string,
		country: string,
	): Promise<PlayLookupResult> {
		let app: Awaited<ReturnType<typeof gplay.app>>;
		try {
			app = await gplay.app({ appId, country, lang: langFor(country) });
		} catch {
			buildError("notFound", {
				info: "App not found on Google Play for this country.",
			});
		}
		return {
			country,
			description: app.description ?? "",
			developer: app.developer ?? "",
			genre: app.genre ?? "",
			genres: app.genre ? [app.genre] : [],
			icon: app.icon,
			name: app.title ?? "",
			price: app.free ? "Free" : app.priceText,
			rating: app.score,
			ratingsCount: app.ratings,
			released: toIsoDate(app.released),
			screenshots: app.screenshots?.length ?? 0,
			screenshotUrls: (app.screenshots ?? []).slice(0, 10),
			trackId: appId,
			updated: app.updated ? new Date(app.updated).toISOString() : undefined,
			url: app.url,
		};
	}

	/** Lightweight app-name search for the free tool's typeahead. */
	static async searchApps(term: string, country: string) {
		const results = await gplay.search({
			country,
			lang: langFor(country),
			num: 6,
			term,
		});
		return results.map((r) => ({
			appId: r.appId,
			developer: r.developer ?? "",
			icon: r.icon,
			rating: r.score,
			title: r.title,
		}));
	}

	/**
	 * Competitor list (top of the search, hydrated with review counts) plus
	 * the rank of `appId` in the top 50 - the exact inputs the browser-side
	 * scoring engine needs for one keyword.
	 */
	static async keywordData(
		keyword: string,
		country: string,
		appId?: string,
	): Promise<{ competitors: KeywordCompetitor[]; rank: number | null }> {
		const key = `${country}:${keyword.toLowerCase().trim()}`;
		let entry = cacheGet(key);
		if (!entry) {
			const results = await gplay.search({
				country,
				lang: langFor(country),
				num: SEARCH_LIMIT,
				term: keyword,
			});
			const orderedIds = results.map((r) => r.appId);
			const top = results.slice(0, KEYWORD_DETAIL_COUNT);
			const competitors: KeywordCompetitor[] = [];
			// Hydrate details in small parallel batches; a failed detail keeps
			// the lightweight search row (rating only, no review count).
			for (let i = 0; i < top.length; i += DETAIL_CONCURRENCY) {
				const batch = top.slice(i, i + DETAIL_CONCURRENCY);
				const settled = await Promise.allSettled(
					batch.map((r) =>
						gplay.app({ appId: r.appId, country, lang: langFor(country) }),
					),
				);
				settled.forEach((outcome, j) => {
					const row = batch[j];
					if (outcome.status === "fulfilled") {
						const detail = outcome.value;
						competitors.push({
							developer: detail.developer ?? row.developer ?? "",
							genre: detail.genre,
							icon: detail.icon ?? row.icon,
							price: detail.free ? "Free" : detail.priceText,
							rating: detail.score ?? row.score,
							ratingsCount: detail.ratings,
							released: toIsoDate(detail.released),
							title: detail.title ?? row.title,
							trackId: row.appId,
							url: detail.url ?? row.url,
						});
					} else {
						competitors.push({
							developer: row.developer ?? "",
							icon: row.icon,
							rating: row.score,
							title: row.title,
							trackId: row.appId,
							url: row.url,
						});
					}
				});
			}
			entry = {
				competitors,
				expiresAt: Date.now() + CACHE_TTL_MS,
				orderedIds,
			};
			cacheSet(key, entry);
			log.info(
				{ competitors: competitors.length, country, keyword },
				"Play keyword data fetched",
			);
		}
		const rank = appId ? entry.orderedIds.indexOf(appId) : -1;
		return {
			competitors: entry.competitors,
			rank: rank >= 0 ? rank + 1 : null,
		};
	}
}

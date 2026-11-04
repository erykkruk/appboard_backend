import {
	AppleAdsService,
	inferAppleGenre,
} from "@/modules/apple-ads/apple-ads.service";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import {
	appstoreCompetitors,
	appstoreKeywordRank,
	appstoreKeywordRankStrict,
	appstoreKeywordSearch,
	appstoreKeywordSearchStrict,
	appstoreMeta,
	appstoreReviews,
	appstoreSearch,
	appstoreSearchPosition,
} from "./appstore.client";
import {
	type CachedKeywordSearch,
	KeywordScoreCacheService,
	normalizeCacheKeyword,
} from "./keyword-score-cache.service";
import { KeywordScoresHistoryService } from "./keyword-scores-history.service";
import {
	calcOpportunity,
	calculateDifficulty,
	classifyKeyword,
	estimateDownloads,
	estimatePopularity,
} from "./keyword-scoring";
import {
	playstoreMeta,
	playstoreReviewStats,
	playstoreReviews,
	playstoreSearch,
	playstoreSearchPosition,
	playstoreSimilar,
} from "./playstore.client";
import { computeHeuristics } from "./research.heuristics";
import {
	type HeuristicStats,
	type KeywordPosition,
	type KeywordScore,
	type MarketSnapshot,
	type ParsedStoreUrl,
	parseStoreUrl,
	RESEARCH_DEFAULT_MARKETS,
	type ResearchAppMeta,
	type ResearchReview,
	type ResearchStore,
	type SearchSuggestion,
} from "./research.types";

const log = createLogger("research");

const MIN_SEARCH_TERM_LEN = 2;
const SEARCH_PER_STORE_BOTH = 6;
const SEARCH_PER_STORE_SINGLE = 12;
const MAX_KEYWORDS = 15;
const NEGATIVE_MAX_STARS = 3;
const MAX_SCORED_KEYWORDS = 10;
const SCORING_SEARCH_LIMIT = 25;
const SCORING_COMPETITORS_RETURNED = 10;
// Adaptive pacing between iTunes calls: start polite, back off on failures,
// decay back once calls succeed again. Bounded so one batch request cannot
// hang the HTTP response for long.
const SCORING_DELAY_BASE_MS = 300;
const SCORING_DELAY_MAX_MS = 3_000;
const SCORING_DELAY_GROWTH = 2;

/** Wraps one store request, e.g. in the process-wide rank-lookup throttle. */
export type StorePacer = <T>(call: () => Promise<T>) => Promise<T>;

/**
 * Top-200 rank through the pacer. A lookup the store still refuses after the
 * pacer's retries is logged and read as unknown (null), as before.
 */
async function pacedKeywordRank(
	pace: StorePacer,
	keyword: string,
	appstoreId: string,
	country: string,
): Promise<number | null> {
	try {
		return await pace(() =>
			appstoreKeywordRankStrict(keyword, appstoreId, country),
		);
	} catch (err) {
		log.warn({ country, err, keyword }, "Keyword rank lookup failed");
		return null;
	}
}

export type SearchScope = "both" | "appstore" | "playstore";

export type ApplePopularityContext = Awaited<
	ReturnType<typeof AppleAdsService.popularityContext>
>;

/**
 * The full score of one keyword from its (possibly cached) App Store search.
 * Pure over its inputs: the search is shared by every workspace, `apple`
 * (the workspace's popularity source) and `appRank` (the asking app) are
 * not, which is why they are applied here and never stored in the cache.
 */
export function scoreFromSearch(
	search: CachedKeywordSearch,
	country: string,
	apple: ApplePopularityContext | null,
	extra: { appRank?: number | null; cached: boolean },
): KeywordScore {
	const { competitors, keyword } = search;
	const internalPopularity = estimatePopularity(competitors, keyword);
	const applePopularity = apple?.values.get(keyword) ?? null;
	const appleGenre = inferAppleGenre(competitors);

	// Effective popularity: Apple's official value when selected and
	// present; otherwise the internal estimate, capped just below the
	// keyword's own category floor when the term is provably absent
	// from the active dataset (absence = not top-500 in its genre).
	let popularity = internalPopularity;
	let popularitySource: "internal" | "apple" = "internal";
	let popularityFallback = false;
	if (apple?.source === "apple" && apple.hasDataset) {
		if (applePopularity !== null) {
			popularity = applePopularity;
			popularitySource = "apple";
		} else {
			popularityFallback = true;
			const floor = apple.floorFor(appleGenre);
			if (floor !== null && internalPopularity !== null) {
				popularity = Math.min(internalPopularity, Math.max(1, floor - 1));
			}
		}
	}

	const difficulty = calculateDifficulty(competitors, keyword);
	return {
		appleGenre,
		applePopularity,
		appRank: extra.appRank,
		breakdown: difficulty.breakdown,
		cached: extra.cached,
		classification: classifyKeyword(popularity, difficulty.score),
		competitors: competitors.slice(0, SCORING_COMPETITORS_RETURNED),
		country,
		difficulty: difficulty.score,
		difficultyLabel: difficulty.label,
		downloads: estimateDownloads(popularity, country),
		internalPopularity,
		keyword,
		opportunity: calcOpportunity(popularity, difficulty.score),
		popularity,
		popularityFallback,
		popularitySource,
		scoredAt: search.scoredAt.toISOString(),
		tiers: difficulty.tiers,
	};
}

function failedScore(
	keyword: string,
	country: string,
	err: unknown,
): KeywordScore {
	const empty = calculateDifficulty([], keyword);
	return {
		breakdown: empty.breakdown,
		classification: "unknown",
		competitors: [],
		country,
		difficulty: 0,
		difficultyLabel: "no-data",
		downloads: estimateDownloads(null, country),
		error: err instanceof Error ? err.message : "Unknown error",
		keyword,
		opportunity: 0,
		popularity: null,
		tiers: empty.tiers,
	};
}

export class ResearchService {
	static async search(
		term: string,
		country: string,
		scope: SearchScope = "both",
	): Promise<SearchSuggestion[]> {
		if (term.trim().length < MIN_SEARCH_TERM_LEN) return [];
		const perStore =
			scope === "both" ? SEARCH_PER_STORE_BOTH : SEARCH_PER_STORE_SINGLE;
		const [apple, play] = await Promise.allSettled([
			scope !== "playstore"
				? appstoreSearch(term, country, perStore)
				: Promise.reject(new Error("skipped")),
			scope !== "appstore"
				? playstoreSearch(term, country, perStore)
				: Promise.reject(new Error("skipped")),
		]);
		return [
			...(apple.status === "fulfilled" ? apple.value : []),
			...(play.status === "fulfilled" ? play.value : []),
		];
	}

	static resolveTarget(
		body: {
			url?: string;
			store?: ResearchStore;
			id?: string;
			country?: string;
		},
		defaultCountry = "us",
	): ParsedStoreUrl {
		if (body.url) {
			const parsed = parseStoreUrl(body.url, body.country ?? defaultCountry);
			if (!parsed) {
				buildError("badRequest", {
					info: "Unrecognized store URL. Paste an App Store or Google Play app link.",
				});
			}
			return parsed;
		}
		if (body.store && body.id) {
			return {
				country: body.country ?? defaultCountry,
				id: body.id,
				store: body.store,
			};
		}
		buildError("badRequest", {
			info: "Provide either a store URL or an explicit store + id pair.",
		});
	}

	static async scrape(
		target: ParsedStoreUrl,
		deep = false,
	): Promise<{
		meta: ResearchAppMeta;
		reviews: ResearchReview[];
		heuristics: HeuristicStats;
	}> {
		const { country, id, store } = target;
		const [meta, reviews] =
			store === "appstore"
				? await Promise.all([
						appstoreMeta(id, country),
						appstoreReviews(id, country, deep),
					])
				: await Promise.all([
						playstoreMeta(id, country),
						playstoreReviews(id, country, deep),
					]);
		log.info(
			{ country, id, reviews: reviews.length, store },
			"Research scrape complete",
		);
		return { heuristics: computeHeuristics(reviews), meta, reviews };
	}

	/**
	 * Search-ranking position (top 50) of a single app for one keyword in one
	 * store. Returns null when the store answered and the app is not in the top
	 * results; THROWS when the store could not be asked (throttled, 5xx,
	 * network), so rank tracking can tell "not ranked" from "not measured".
	 * A single seam so callers (rank tracking) can mock store lookups in tests.
	 * `onRanking` gets the ordered Play package ids the position was read
	 * from (Play only), so one search can serve several tracked apps.
	 */
	static async positionFor(
		store: ResearchStore,
		keyword: string,
		id: string,
		country: string,
		onRanking?: (ranking: string[]) => void,
	): Promise<number | null> {
		return store === "appstore"
			? appstoreSearchPosition(keyword, id, country)
			: playstoreSearchPosition(keyword, id, country, onRanking);
	}

	static async keywordPositions(
		keywords: string[],
		country: string,
		appstoreId?: string,
		playstoreId?: string,
	): Promise<KeywordPosition[]> {
		const capped = keywords
			.map((k) => k.trim())
			.filter(Boolean)
			.slice(0, MAX_KEYWORDS);
		const positions: KeywordPosition[] = [];
		for (const keyword of capped) {
			const [apple, play] = await Promise.all([
				appstoreId
					? appstoreSearchPosition(keyword, appstoreId, country).catch(
							() => null,
						)
					: Promise.resolve(undefined),
				playstoreId
					? playstoreSearchPosition(keyword, playstoreId, country).catch(
							() => null,
						)
					: Promise.resolve(undefined),
			]);
			positions.push({ appstore: apple, keyword, playstore: play });
		}
		return positions;
	}

	/**
	 * Ask the App Store for the search a score is derived from (top 25) and
	 * store the answer in the global cache for every workspace. Callers read
	 * the cache first; this is the miss path. Paced (scheduled) calls skip
	 * the SSR/lookup fallback: it would hit Apple outside the throttle and
	 * hide the 403 the throttle needs.
	 */
	static async fetchKeywordSearch(
		keyword: string,
		country: string,
		options: { pace?: StorePacer; now?: Date } = {},
	): Promise<CachedKeywordSearch> {
		const { pace } = options;
		const competitors = pace
			? await pace(() =>
					appstoreKeywordSearchStrict(keyword, country, SCORING_SEARCH_LIMIT),
				)
			: await appstoreKeywordSearch(keyword, country, SCORING_SEARCH_LIMIT);
		const scoredAt = options.now ?? new Date();
		try {
			return await KeywordScoreCacheService.put(
				keyword,
				country,
				competitors,
				scoredAt,
			);
		} catch (err) {
			log.warn({ country, err, keyword }, "Keyword score cache write failed");
			return { competitors, country, keyword, scoredAt };
		}
	}

	/**
	 * Score keywords for ASO targeting: popularity estimate, difficulty with
	 * breakdown + ranking tiers, opportunity, classification and download
	 * estimates - all derived from one App Store search per keyword.
	 * The search comes from the global (keyword, country) cache when it is
	 * younger than KEYWORD_SCORE_CACHE_TTL_DAYS, so a keyword any workspace
	 * scored this week costs no App Store call; `refresh` bypasses the cache
	 * for this (small, explicit) batch. Everything app- or workspace-specific
	 * (the own app's rank, the Apple Ads popularity source) is computed per
	 * request on top of the cached search, never cached.
	 * Failures are reported per keyword so a batch survives partial outages.
	 * When a workspaceId is given, successful scores are also persisted as
	 * that workspace's history snapshot of the day the search was made
	 * (best-effort).
	 * `pace` routes every App Store request through a caller-supplied
	 * throttle (the scheduler passes the process-wide store throttle) and
	 * replaces the local per-batch delay.
	 */
	static async keywordScores(
		keywords: string[],
		country: string,
		appstoreId?: string,
		workspaceId?: string,
		options: { pace?: StorePacer; refresh?: boolean; now?: Date } = {},
	): Promise<KeywordScore[]> {
		const { pace } = options;
		const now = options.now ?? new Date();
		const unique = [
			...new Set(keywords.map(normalizeCacheKeyword).filter(Boolean)),
		].slice(0, MAX_SCORED_KEYWORDS);

		const apple = workspaceId
			? await ResearchService.appleContext(workspaceId, country, unique)
			: null;
		const cached = options.refresh
			? new Map<string, CachedKeywordSearch>()
			: await KeywordScoreCacheService.getFresh(unique, country, now).catch(
					(err) => {
						log.warn({ country, err }, "Keyword score cache read failed");
						return new Map<string, CachedKeywordSearch>();
					},
				);

		const scores: KeywordScore[] = [];
		let delayMs = SCORING_DELAY_BASE_MS;
		let askedStore = false;
		for (const keyword of unique) {
			const hit = cached.get(keyword);
			const needsStore = !hit || Boolean(appstoreId);
			if (needsStore && askedStore && !pace) {
				await new Promise((r) => setTimeout(r, delayMs));
			}
			if (needsStore) askedStore = true;
			try {
				const search =
					hit ??
					(await ResearchService.fetchKeywordSearch(keyword, country, {
						now,
						pace,
					}));
				const appRank = appstoreId
					? pace
						? await pacedKeywordRank(pace, keyword, appstoreId, country)
						: await appstoreKeywordRank(keyword, appstoreId, country)
					: undefined;
				scores.push(
					scoreFromSearch(search, country, apple, {
						appRank,
						cached: Boolean(hit),
					}),
				);
				delayMs = Math.max(
					SCORING_DELAY_BASE_MS,
					delayMs / SCORING_DELAY_GROWTH,
				);
			} catch (err) {
				log.warn({ country, err, keyword }, "Keyword scoring failed");
				delayMs = Math.min(
					SCORING_DELAY_MAX_MS,
					delayMs * SCORING_DELAY_GROWTH,
				);
				scores.push(failedScore(keyword, country, err));
			}
		}
		if (workspaceId) {
			await KeywordScoresHistoryService.upsertScores(workspaceId, scores).catch(
				(err) => {
					log.warn({ err, workspaceId }, "Keyword score history upsert failed");
				},
			);
		}
		return scores;
	}

	/**
	 * Apple dual-source context: the workspace's chosen source plus the
	 * active-week official values for the whole batch (one query). Null when
	 * it cannot be read - scoring then uses the internal estimate.
	 */
	static async appleContext(
		workspaceId: string,
		country: string,
		keywords: string[],
	): Promise<ApplePopularityContext | null> {
		return AppleAdsService.popularityContext(
			workspaceId,
			country,
			keywords,
		).catch(() => null);
	}

	static async markets(
		store: ResearchStore,
		id: string,
		markets?: string[],
	): Promise<MarketSnapshot[]> {
		const list = markets?.length ? markets : [...RESEARCH_DEFAULT_MARKETS];
		return Promise.all(
			list.map(async (country): Promise<MarketSnapshot> => {
				try {
					if (store === "appstore") {
						const [meta, reviews] = await Promise.all([
							appstoreMeta(id, country),
							appstoreReviews(id, country),
						]);
						const negative = reviews.filter(
							(r) => r.stars <= NEGATIVE_MAX_STARS,
						).length;
						return {
							country,
							negativeShare: reviews.length
								? negative / reviews.length
								: undefined,
							rating: meta.rating,
							ratingsCount: meta.ratingsCount,
						};
					}
					const [meta, stats] = await Promise.all([
						playstoreMeta(id, country),
						playstoreReviewStats(id, country),
					]);
					return {
						country,
						devReplyRate: stats.devReplyRate,
						negativeShare: stats.negativeShare,
						rating: meta.rating,
						ratingsCount: meta.ratingsCount,
					};
				} catch (err) {
					return {
						country,
						error: err instanceof Error ? err.message : "Unknown error",
					};
				}
			}),
		);
	}

	static async competitors(
		store: ResearchStore,
		id: string,
		title: string,
		country: string,
		genre?: string,
		developer?: string,
	): Promise<SearchSuggestion[]> {
		if (store === "playstore") {
			return playstoreSimilar(id, country, developer);
		}
		return appstoreCompetitors(id, title, genre ?? "", country);
	}
}

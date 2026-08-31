import {
	AppleAdsService,
	inferAppleGenre,
} from "@/modules/apple-ads/apple-ads.service";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import {
	appstoreCompetitors,
	appstoreKeywordRank,
	appstoreKeywordSearch,
	appstoreMeta,
	appstoreReviews,
	appstoreSearch,
	appstoreSearchPosition,
} from "./appstore.client";
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

export type SearchScope = "both" | "appstore" | "playstore";

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
	 * store. Returns null on error or when the app is not in the top results.
	 * A single seam so callers (rank tracking) can mock store lookups in tests.
	 */
	static async positionFor(
		store: ResearchStore,
		keyword: string,
		id: string,
		country: string,
	): Promise<number | null> {
		try {
			return store === "appstore"
				? await appstoreSearchPosition(keyword, id, country)
				: await playstoreSearchPosition(keyword, id, country);
		} catch {
			return null;
		}
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
	 * Score keywords for ASO targeting: popularity estimate, difficulty with
	 * breakdown + ranking tiers, opportunity, classification and download
	 * estimates - all derived from one App Store search per keyword.
	 * Failures are reported per keyword so a batch survives partial outages.
	 * When a workspaceId is given, successful scores are also persisted as
	 * today's history snapshots (best-effort).
	 */
	static async keywordScores(
		keywords: string[],
		country: string,
		appstoreId?: string,
		workspaceId?: string,
	): Promise<KeywordScore[]> {
		const unique = [
			...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)),
		].slice(0, MAX_SCORED_KEYWORDS);

		// Apple dual-source context: the workspace's chosen source plus the
		// active-week official values for the whole batch (one query).
		const apple = workspaceId
			? await AppleAdsService.popularityContext(
					workspaceId,
					country,
					unique,
				).catch(() => null)
			: null;

		const scores: KeywordScore[] = [];
		let delayMs = SCORING_DELAY_BASE_MS;
		for (const keyword of unique) {
			if (scores.length > 0) {
				await new Promise((r) => setTimeout(r, delayMs));
			}
			try {
				const competitors = await appstoreKeywordSearch(
					keyword,
					country,
					SCORING_SEARCH_LIMIT,
				);
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
				const appRank = appstoreId
					? await appstoreKeywordRank(keyword, appstoreId, country)
					: undefined;
				scores.push({
					appleGenre,
					applePopularity,
					appRank,
					breakdown: difficulty.breakdown,
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
					tiers: difficulty.tiers,
				});
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
				scores.push({
					breakdown: calculateDifficulty([], keyword).breakdown,
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
					tiers: calculateDifficulty([], keyword).tiers,
				});
			}
		}
		if (workspaceId) {
			await KeywordScoresHistoryService.upsertToday(workspaceId, scores).catch(
				(err) => {
					log.warn({ err, workspaceId }, "Keyword score history upsert failed");
				},
			);
		}
		return scores;
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

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import {
	extractCompetitorCandidates,
	isWinnableScore,
} from "@/modules/research/listing-audit";
import type {
	KeywordClassification,
	KeywordCompetitor,
	KeywordScore,
} from "@/modules/research/scoring-types";
import { db } from "@/utils/db";
import {
	apps,
	keywordScoreSnapshots,
	trackedKeywords,
} from "@/utils/db/schema";
import { MAX_KEYWORDS_PER_COUNTRY } from "./tracking.types";

/** Ideas shown per market: enough to pick from, few enough to score by hand. */
export const MAX_SUGGESTIONS = 20;
/** Only rivals seen in recent searches describe the category today. */
const SOURCE_DAYS = 30;

export interface KeywordSuggestion {
	keyword: string;
	popularity: number | null;
	difficulty: number | null;
	opportunity: number | null;
	classification: KeywordClassification | null;
	/** Our App Store position when the term was scored (null = not in results). */
	appRank: number | null;
	/** Day of the newest score, null when the term was never scored. */
	scoredAt: string | null;
	winnable: boolean | null;
}

export interface MarketSuggestions {
	country: string;
	cap: number;
	trackedCount: number;
	/** Tracked keywords whose scored search results the ideas were mined from. */
	sourceKeywords: number;
	suggestions: KeywordSuggestion[];
}

function cutoffDay(days: number): string {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);
}

/**
 * "What else should we track here?" answered from data we already store: the
 * apps that show up in the search results of the keywords you track. Their
 * titles name the category in the market's own words. No store call happens
 * here; scoring the ideas is a separate, explicit step.
 */
export class KeywordSuggestionsService {
	static async forMarket(
		appId: string,
		workspaceId: string,
		countryInput: string,
	): Promise<MarketSuggestions> {
		const country = countryInput.toLowerCase();
		const [app] = await db
			.select({ externalId: apps.externalId, name: apps.name })
			.from(apps)
			.where(eq(apps.id, appId))
			.limit(1);
		const tracked = (
			await db
				.select({ keyword: trackedKeywords.keyword })
				.from(trackedKeywords)
				.where(
					and(
						eq(trackedKeywords.appId, appId),
						eq(trackedKeywords.country, country),
					),
				)
		).map((row) => row.keyword.toLowerCase());

		const base: MarketSuggestions = {
			cap: MAX_KEYWORDS_PER_COUNTRY,
			country,
			sourceKeywords: 0,
			suggestions: [],
			trackedCount: tracked.length,
		};
		if (!app || !tracked.length) return base;

		const sources = await KeywordSuggestionsService.latestPayloads(
			workspaceId,
			country,
			tracked,
		);
		const competitors: KeywordCompetitor[] = sources.flatMap(
			(payload) => payload.competitors ?? [],
		);
		const ownGenre = competitors.find(
			(c) => c.trackId === app.externalId,
		)?.genre;
		const ideas = extractCompetitorCandidates(
			competitors,
			app.name,
			tracked,
			ownGenre,
		).slice(0, MAX_SUGGESTIONS);

		const scores = await KeywordSuggestionsService.latestScores(
			workspaceId,
			country,
			ideas,
		);
		return {
			...base,
			sourceKeywords: sources.length,
			suggestions: ideas.map((keyword) => {
				const score = scores.get(keyword);
				return {
					appRank: score?.appRank ?? null,
					classification:
						(score?.classification as KeywordClassification | undefined) ??
						null,
					difficulty: score?.difficulty ?? null,
					keyword,
					opportunity: score?.opportunity ?? null,
					popularity: score?.popularity ?? null,
					scoredAt: score?.day ?? null,
					winnable: score
						? isWinnableScore({
								appRank: score.appRank,
								difficulty: score.difficulty,
							})
						: null,
				};
			}),
		};
	}

	/** Newest stored score payload per tracked keyword in the market. */
	private static async latestPayloads(
		workspaceId: string,
		country: string,
		keywords: string[],
	): Promise<KeywordScore[]> {
		const rows = await db
			.selectDistinctOn([keywordScoreSnapshots.keyword], {
				keyword: keywordScoreSnapshots.keyword,
				payload: keywordScoreSnapshots.payload,
			})
			.from(keywordScoreSnapshots)
			.where(
				and(
					eq(keywordScoreSnapshots.workspaceId, workspaceId),
					eq(keywordScoreSnapshots.country, country),
					inArray(keywordScoreSnapshots.keyword, keywords),
					gte(keywordScoreSnapshots.day, cutoffDay(SOURCE_DAYS)),
				),
			)
			.orderBy(keywordScoreSnapshots.keyword, desc(keywordScoreSnapshots.day));
		return rows.map((row) => row.payload);
	}

	private static async latestScores(
		workspaceId: string,
		country: string,
		keywords: string[],
	) {
		const out = new Map<
			string,
			{
				appRank: number | null;
				classification: string;
				day: string;
				difficulty: number;
				opportunity: number;
				popularity: number | null;
			}
		>();
		if (!keywords.length) return out;
		const rows = await db
			.selectDistinctOn([keywordScoreSnapshots.keyword], {
				appRank: keywordScoreSnapshots.appRank,
				classification: keywordScoreSnapshots.classification,
				day: keywordScoreSnapshots.day,
				difficulty: keywordScoreSnapshots.difficulty,
				keyword: keywordScoreSnapshots.keyword,
				opportunity: keywordScoreSnapshots.opportunity,
				popularity: keywordScoreSnapshots.popularity,
			})
			.from(keywordScoreSnapshots)
			.where(
				and(
					eq(keywordScoreSnapshots.workspaceId, workspaceId),
					eq(keywordScoreSnapshots.country, country),
					inArray(keywordScoreSnapshots.keyword, keywords),
				),
			)
			.orderBy(keywordScoreSnapshots.keyword, desc(keywordScoreSnapshots.day));
		for (const row of rows) out.set(row.keyword, row);
		return out;
	}
}

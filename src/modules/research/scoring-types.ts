/**
 * Types for the keyword-scoring engine. SELF-CONTAINED ON PURPOSE: this file
 * and keyword-scoring.ts have no other imports, so both can be copied
 * verbatim into browser bundles (the panel's free ASO check syncs them via
 * appboard_web/scripts/sync-aso-engine.sh). Keep it dependency-free.
 */

/** One competitor app from an App Store keyword search, scoring-ready. */
export interface KeywordCompetitor {
	trackId: string;
	title: string;
	developer: string;
	rating?: number;
	ratingsCount?: number;
	released?: string;
	genre?: string;
	icon?: string;
	url?: string;
	price?: string;
}

export type KeywordClassification =
	| "sweet-spot"
	| "good-target"
	| "hidden-gem"
	| "moderate"
	| "high-competition"
	| "low-volume"
	| "avoid"
	| "unknown";

export interface KeywordDifficultyBreakdown {
	rawTotal: number;
	overrideReason: "smallResultSet" | "weakLeader" | "backfill" | null;
	isBrandKeyword: boolean;
	brandName: string | null;
	ratingVolume: number;
	reviewVelocity: number;
	dominantPlayers: number;
	ratingQuality: number;
	marketAge: number;
	publisherDiversity: number;
	titleRelevance: number;
	titleMatchCount: number;
	medianReviews: number;
	avgReviews: number;
}

export interface KeywordRankingTier {
	tierScore: number;
	label: string;
	minReviews: number;
	weakestApp: string | null;
	medianReviews: number;
	weakCount: number;
	freshCount: number;
	titleKeywordCount: number;
	totalApps: number;
}

export interface KeywordRankingTiers {
	top5: KeywordRankingTier;
	top10: KeywordRankingTier;
	top20: KeywordRankingTier;
}

export interface KeywordDifficulty {
	score: number;
	label: string;
	breakdown: KeywordDifficultyBreakdown;
	tiers: KeywordRankingTiers;
}

export interface DownloadEstimates {
	dailySearches: number;
	positions: Array<{
		position: number;
		ttr: number;
		low: number;
		high: number;
	}>;
	tiers: {
		top5: { low: number; high: number };
		top6to10: { low: number; high: number };
		top11to20: { low: number; high: number };
	};
}

/**
 * Full scoring result for one keyword in one country. `popularity` is the
 * EFFECTIVE value (drives opportunity/classification/downloads): the internal
 * estimate by default, or Apple's official value when the workspace selected
 * the apple source and the term is present in the active weekly dataset.
 */
export interface KeywordScore {
	keyword: string;
	country: string;
	popularity: number | null;
	internalPopularity?: number | null;
	applePopularity?: number | null;
	popularitySource?: "internal" | "apple";
	popularityFallback?: boolean;
	appleGenre?: string | null;
	difficulty: number;
	difficultyLabel: string;
	opportunity: number;
	classification: KeywordClassification;
	breakdown: KeywordDifficultyBreakdown;
	tiers: KeywordRankingTiers;
	downloads: DownloadEstimates;
	appRank?: number | null;
	competitors: KeywordCompetitor[];
	error?: string;
}

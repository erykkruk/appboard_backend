export type ResearchStore = "appstore" | "playstore";

/** Map a connected app's platform (`ios` / `android`) to its research store. */
export function platformToStore(platform: string): ResearchStore {
	return platform === "ios" ? "appstore" : "playstore";
}

export interface ResearchAppMeta {
	store: ResearchStore;
	id: string;
	title: string;
	developer: string;
	icon?: string;
	rating?: number;
	ratingsCount?: number;
	reviewsCount?: number;
	description?: string;
	lastUpdate?: string;
	released?: string;
	version?: string;
	url: string;
	country: string;
	genre?: string;
	contentRating?: string;
	downloads?: string;
	minInstalls?: number;
	price?: string;
	free?: boolean;
	offersIAP?: boolean;
	iapRange?: string;
	adSupported?: boolean;
	summary?: string;
	screenshots?: string[];
}

export interface ResearchReview {
	store: ResearchStore;
	stars: number;
	title?: string;
	text: string;
	version?: string;
	date?: string;
}

export interface SearchSuggestion {
	store: ResearchStore;
	id: string;
	title: string;
	developer: string;
	icon?: string;
	rating?: number;
	url: string;
}

export interface KeywordPosition {
	keyword: string;
	appstore?: number | null;
	playstore?: number | null;
}

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

export interface MarketSnapshot {
	country: string;
	rating?: number;
	ratingsCount?: number;
	negativeShare?: number;
	devReplyRate?: number;
	error?: string;
}

export interface AnalysisCategory {
	id: string;
	count: number;
	severity: "low" | "medium" | "high";
	insight: string;
	quotes: string[];
}

export interface AnalysisFeature {
	name: string;
	mentions: number;
	insight: string;
}

export interface ResearchAnalysis {
	summary: string;
	sentiment: { positive: number; neutral: number; negative: number };
	categories: AnalysisCategory[];
	featuresLoved: AnalysisFeature[];
	featuresHated: AnalysisFeature[];
	topIrritations: string[];
	quickWins: string[];
	metadataTips: string[];
	asoKeywords: Array<{ keyword: string; reason: string }>;
}

export interface VisualAnalysis {
	iconVerdict: string;
	screenshotFindings: string[];
	conversionTips: string[];
}

export interface CompareAnalysis {
	verdict: string;
	theyDoBetter: string[];
	weDoBetter: string[];
	featureGaps: string[];
}

export interface HeuristicBucket {
	id: string;
	label: string;
	count: number;
	quotes: string[];
}

export interface HeuristicStats {
	total: number;
	byStars: Record<number, number>;
	negative: number;
	negativeShare: number;
	buckets: HeuristicBucket[];
}

/**
 * Full persisted payload of a saved research run (standalone tool or per-app,
 * manual or scheduled). Stored as jsonb in the `research_runs` table.
 */
export interface ResearchRunReport {
	meta: ResearchAppMeta;
	heuristics: HeuristicStats;
	reviewsCount: number;
	keywords?: KeywordPosition[];
	analysis?: ResearchAnalysis;
	deep?: boolean;
}

export interface ParsedStoreUrl {
	store: ResearchStore;
	id: string;
	country: string;
}

export const RESEARCH_CATEGORIES = [
	{ id: "ux-ui", label: "UX / UI" },
	{ id: "wydajnosc", label: "Performance" },
	{ id: "crash-bugi", label: "Crashes / Bugs" },
	{ id: "platnosci", label: "Payments / Subscriptions" },
	{ id: "logowanie", label: "Login / Account" },
	{ id: "brak-funkcji", label: "Missing features" },
	{ id: "obsluga-klienta", label: "Customer support" },
	{ id: "powiadomienia", label: "Notifications" },
	{ id: "sync-offline", label: "Sync / Offline" },
	{ id: "reklamy", label: "Ads / Monetization" },
	{ id: "prywatnosc", label: "Privacy / Security" },
	{ id: "pochwaly", label: "Praise (what works)" },
	{ id: "inne", label: "Other" },
] as const;

export const RESEARCH_DEFAULT_MARKETS = [
	"us",
	"pl",
	"gb",
	"de",
	"fr",
	"es",
] as const;

const APPSTORE_RE =
	/apps\.apple\.com\/(?:([a-z]{2})\/)?[^/]*\/?app\/[^/]*\/?id(\d+)/i;
const APPSTORE_SHORT_RE = /itunes\.apple\.com\/(?:([a-z]{2})\/)?.*id(\d+)/i;
const PLAY_RE = /play\.google\.com\/store\/apps\/details\?[^#]*\bid=([\w.]+)/i;

export function parseStoreUrl(
	raw: string,
	defaultCountry = "us",
): ParsedStoreUrl | null {
	const url = raw.trim();
	if (!url) return null;

	const play = url.match(PLAY_RE);
	if (play) {
		const gl = url.match(/[?&]gl=([a-z]{2})/i);
		return {
			country: gl?.[1]?.toLowerCase() ?? defaultCountry,
			id: play[1],
			store: "playstore",
		};
	}

	const apple = url.match(APPSTORE_RE) ?? url.match(APPSTORE_SHORT_RE);
	if (apple) {
		return {
			country: apple[1]?.toLowerCase() ?? defaultCountry,
			id: apple[2],
			store: "appstore",
		};
	}

	return null;
}

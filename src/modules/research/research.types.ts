export type ResearchStore = "appstore" | "playstore";

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

export interface ParsedStoreUrl {
	store: ResearchStore;
	id: string;
	country: string;
}

export const RESEARCH_CATEGORIES = [
	{ id: "ux-ui", label: "UX / UI" },
	{ id: "wydajnosc", label: "Wydajność" },
	{ id: "crash-bugi", label: "Crashe / Bugi" },
	{ id: "platnosci", label: "Płatności / Subskrypcje" },
	{ id: "logowanie", label: "Logowanie / Konto" },
	{ id: "brak-funkcji", label: "Brakujące funkcje" },
	{ id: "obsluga-klienta", label: "Obsługa klienta" },
	{ id: "powiadomienia", label: "Powiadomienia" },
	{ id: "sync-offline", label: "Synchronizacja / Offline" },
	{ id: "reklamy", label: "Reklamy / Monetyzacja" },
	{ id: "prywatnosc", label: "Prywatność / Bezpieczeństwo" },
	{ id: "pochwaly", label: "Pochwały (co działa)" },
	{ id: "inne", label: "Inne" },
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

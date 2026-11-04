import type { DownloadRange } from "@/modules/research/download-estimate";
import type { StorePerformanceStatus } from "@/modules/store-performance/store-performance.types";

/**
 * Where the per-keyword download numbers come from. Google Play publishes
 * real installs per search term (all countries together); Apple publishes
 * nothing per keyword, so App Store numbers are the scoring engine's estimate.
 */
export type KeywordDownloadsSource =
	| "google_play_report"
	| "app_store_estimate"
	| "unsupported";

/** The App Store estimate is a daily model; the panel reads it per month. */
export const ESTIMATE_DAYS_PER_MONTH = 30;

/** Play's traffic-source file has no country column: search terms are app-wide. */
export const PLAY_SEARCH_TERM_SCOPE = "all_countries";

/** Installs (store listing acquisitions) and visitors from one or more Play search terms. */
export interface PlaySearchFunnel {
	acquisitions: number;
	visitors: number;
}

export interface PlayKeywordDownloads {
	/** Month to date; NULL = the keyword is not in Play's report for the month. */
	currentMonth: PlaySearchFunnel | null;
	/** Latest full month; NULL = not in Play's report (Play omits small volumes). */
	latestMonth: PlaySearchFunnel | null;
	/** Play search terms that matched the keyword (case, spacing and accents ignored). */
	terms: string[];
}

export interface EstimatedKeywordDownloads {
	/** Position 21+ sits past the modelled curve: the estimate is zero. */
	beyondModel: boolean;
	perDay: DownloadRange;
	perMonth: DownloadRange;
	popularity: number | null;
	/** Position the estimate was read at (latest rank check). */
	position: number;
	/** Day of the keyword score the curve comes from (YYYY-MM-DD). */
	scoredAt: string;
}

export interface KeywordDownloadsRow {
	/** NULL when the app is not an App Store app, the keyword has no score or no rank. */
	estimate: EstimatedKeywordDownloads | null;
	keyword: string;
	/** NULL when the app is not a Google Play app or the report could not be read. */
	play: PlayKeywordDownloads | null;
}

export interface PlayMonthTotals {
	/** Play wrote a traffic-source file for the month. */
	available: boolean;
	/** Last day the file covers (YYYY-MM-DD). */
	lastDay: string | null;
	/** YYYY-MM */
	month: string;
	/** Installs from the "Google Play search" traffic source, every term included. */
	searchInstalls: number | null;
	searchVisitors: number | null;
}

export interface PlayDownloadsSummary {
	currentMonth: PlayMonthTotals | null;
	fetchedAt: string | null;
	latestMonth: PlayMonthTotals | null;
	/** Explanation and fix when the bucket could not be read. */
	message: string | null;
	scope: typeof PLAY_SEARCH_TERM_SCOPE;
	status: StorePerformanceStatus;
	/** Play reports all TV store traffic as "Other", so no search terms exist. */
	tvOnly: boolean;
}

export interface EstimatedDownloadsSummary {
	daysPerMonth: number;
	perDay: DownloadRange;
	perMonth: DownloadRange;
	/** Keywords with both a score and a rank (they carry an estimate). */
	ranked: number;
	/** Keywords with a score. */
	scored: number;
}

export interface KeywordDownloadsReport {
	country: string;
	estimate: EstimatedDownloadsSummary | null;
	keywords: KeywordDownloadsRow[];
	/** Why there are no numbers, for the unsupported cases. */
	message: string | null;
	platform: string;
	play: PlayDownloadsSummary | null;
	source: KeywordDownloadsSource;
}

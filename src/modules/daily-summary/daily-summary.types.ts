import type { AppDevice } from "@/config/const";

/**
 * Local time (scheduler timezone) the summary goes out: after the 00:00 rank
 * check, the 01:00 score refresh and the 06:00 auto-research.
 */
export const DAILY_SUMMARY_HOUR = 7;
export const DAILY_SUMMARY_MINUTE = 30;
/**
 * While a rank check or auto-research of the workspace is still running, the
 * summary waits for it, but never past this local time: a late mail beats a
 * missing one.
 */
export const DAILY_SUMMARY_WAIT_UNTIL_HOUR = 9;
export const DAILY_SUMMARY_WAIT_UNTIL_MINUTE = 30;
/** No scheduled summary after this local hour (the 12:00 rank check follows). */
export const DAILY_SUMMARY_WINDOW_END_HOUR = 12;

/** Movers listed per direction, per app. */
export const SUMMARY_MOVERS_LIMIT = 5;
/** Starred keywords listed per app. */
export const SUMMARY_STARRED_LIMIT = 6;
/** Strongest markets listed per app. */
export const SUMMARY_MARKETS_LIMIT = 3;
/** Best new keyword ideas listed per app. */
export const SUMMARY_IDEAS_LIMIT = 3;
/** The AI summary line of the research run is cut to this many characters. */
export const SUMMARY_RESEARCH_TEXT_LIMIT = 220;

/** "Send a test summary now": a handful per hour per workspace. */
export const TEST_SEND_MAX_PER_HOUR = 5;

export const DEFAULT_PANEL_URL = "https://app.appboard.dev";

export interface SummaryMover {
	country: string;
	/** Positive = moved up. Null when one of the two checks had no position. */
	delta: number | null;
	keyword: string;
	position: number | null;
	previousPosition: number | null;
}

export interface SummaryMarket {
	country: string;
	medianPosition: number | null;
	ranked: number;
	top10: number;
}

export interface SummaryIdea {
	country: string;
	keyword: string;
	opportunity: number;
}

export interface SummaryResearch {
	at: Date;
	country: string;
	/** Keyword ideas scored by the run, null for runs recorded before 0.23. */
	ideasScored: number | null;
	/** Markets the ideas were scored in, null when unknown. */
	ideaMarkets: number | null;
	negativeShare: number | null;
	rating: number | null;
	reviewsCount: number;
	summary: string | null;
	topIdeas: SummaryIdea[];
}

export interface SummaryStarred {
	moved: SummaryMover[];
	top10: number;
	total: number;
}

export interface DailySummaryApp {
	appId: string;
	dashboardUrl: string;
	declined: number;
	devices: AppDevice[];
	dropped: number;
	drops: SummaryMover[];
	entered: number;
	gains: SummaryMover[];
	improved: number;
	lastCheckedAt: Date | null;
	name: string;
	platform: string;
	/** Keywords that rank, without the app's own name. */
	ranked: number;
	rankTrackingSupported: boolean;
	research: SummaryResearch | null;
	starred: SummaryStarred | null;
	strongestMarkets: SummaryMarket[];
	/** Top 10 positions, without the app's own name. */
	top10: number;
	tracked: number;
}

export interface DailySummaryTotals {
	apps: number;
	declined: number;
	improved: number;
	ranked: number;
	top10: number;
	tracked: number;
}

export interface DailySummary {
	apps: DailySummaryApp[];
	generatedAt: Date;
	timezone: string;
	totals: DailySummaryTotals;
}

/** What the panel reads and edits. */
export interface DailySummarySettings {
	/** Address set on the workspace setting, null = fallback. */
	email: string | null;
	/** Where the next summary goes (setting, else per-app email, else owner). */
	effectiveEmail: string | null;
	enabled: boolean;
	lastSentAt: Date | null;
	schedule: {
		hour: number;
		minute: number;
		timezone: string;
	};
	/** Apps with rank tracking or auto-research enabled: what the mail covers. */
	trackedApps: number;
}

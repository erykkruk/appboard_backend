import type { AppDevice } from "@/config/const";
import type { RankCheckRunView } from "./rank-check.jobs";
import type { RankTrackingSupport } from "./rank-support";

export const MAX_KEYWORDS_PER_COUNTRY = 40;

// Country used when auto-importing keywords from the ASO profile, which has
// no country dimension of its own.
export const DEFAULT_TRACKING_COUNTRY = "us";

export const AUTO_RESEARCH_FREQUENCIES = [
	"daily",
	"weekly",
	"monthly",
] as const;
export type AutoResearchFrequency = (typeof AUTO_RESEARCH_FREQUENCIES)[number];

// The two daily slots (local hours) the scheduled rank check runs at:
// 00:00 ("12:00 am") and 12:00 ("12:00 pm").
export const RANK_CHECK_HOURS = [0, 12] as const;

export const DEFAULT_SCHEDULER_TZ = "Europe/Warsaw";

export interface RankCheckResult {
	checked: number;
	snapshots: number;
	/** Lookups the store refused after retries - not written as "not ranked". */
	failed: number;
	ranked: number;
}

export const RANK_CHECK_KINDS = ["manual", "scheduled", "summary"] as const;
export type RankCheckKind = (typeof RANK_CHECK_KINDS)[number];

export const RANK_CHECK_STATUSES = [
	"running",
	"completed",
	"failed",
	"interrupted",
] as const;
export type RankCheckStatus = (typeof RANK_CHECK_STATUSES)[number];

/** One keyword the store could not answer for, kept on the run row. */
export interface RankLookupFailure {
	attempts: number;
	country: string;
	error: string;
	keyword: string;
	/** HTTP status from the store, null for network / parse errors. */
	status: number | null;
}

/** Bulk add: what happened to each requested market. */
export interface BulkAddMarketResult {
	added: string[];
	country: string;
	/** Over the per-market cap - not stored. */
	rejected: string[];
	/** Already tracked (or duplicated within the request). */
	skipped: string[];
}

export interface LatestPosition {
	keyword: string;
	country: string;
	platform: string;
	position: number | null;
	previousPosition: number | null;
	// Positive delta = moved UP (better rank); negative = dropped.
	delta: number | null;
	capturedAt: Date;
}

export interface TrackingSummaryStats {
	trackedKeywords: number;
	rankedKeywords: number;
	avgPosition: number | null;
	bestPosition: number | null;
	top10Count: number;
	improvedCount: number;
	declinedCount: number;
	lastCheckedAt: Date | null;
}

/** One market (country) of an app in the per-market overview. */
export interface TrackingMarket {
	avgPosition: number | null;
	bestPosition: number | null;
	country: string;
	/** Ranked both times, worse now. */
	declined: number;
	/** Ranked at the previous measurement, outside the scanned results now. */
	dropped: number;
	/** Outside the scanned results before, ranked now. */
	entered: number;
	/** Keywords the latest run could not measure (store refused). */
	failedLastRun: number;
	/** Ranked both times, better now. */
	improved: number;
	lastCheckedAt: Date | null;
	/** Tracked keywords with at least one measurement. */
	measured: number;
	medianPosition: number | null;
	ranked: number;
	top10: number;
	top50: number;
	tracked: number;
}

export type TrackingMarketTotals = Omit<TrackingMarket, "country"> & {
	markets: number;
};

export interface TrackingMarketsOverview {
	app: {
		devices: AppDevice[];
		externalId: string;
		id: string;
		name: string;
		platform: string;
	};
	lastRun: RankCheckRunView | null;
	markets: TrackingMarket[];
	rankTracking: RankTrackingSupport;
	totals: TrackingMarketTotals;
}

export const MAX_KEYWORDS_PER_COUNTRY = 20;

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

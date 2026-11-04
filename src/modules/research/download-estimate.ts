import type { DownloadEstimates } from "./scoring-types";

export interface DownloadRange {
	high: number;
	low: number;
}

/**
 * Estimated daily search downloads at one rank, read off the curve the
 * scoring engine stored with the keyword score (searches x TTR x CVR, see
 * `estimateDownloads`). The curve covers positions 1-20; below that the model
 * expects no search downloads, so the range is zero rather than a guess.
 * NULL when there is no curve or no rank: nothing was measured.
 */
export function estimatedDailyDownloadsAt(
	downloads: DownloadEstimates | null | undefined,
	rank: number | null | undefined,
): DownloadRange | null {
	if (!downloads?.positions || !rank || rank < 1) return null;
	const point = downloads.positions[rank - 1];
	return point ? { high: point.high, low: point.low } : { high: 0, low: 0 };
}

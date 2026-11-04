import {
	DAILY_SUMMARY_HOUR,
	DAILY_SUMMARY_MINUTE,
	DAILY_SUMMARY_WAIT_UNTIL_HOUR,
	DAILY_SUMMARY_WAIT_UNTIL_MINUTE,
	DAILY_SUMMARY_WINDOW_END_HOUR,
} from "./daily-summary.types";

const MINUTES_PER_HOUR = 60;

interface LocalParts {
	day: string;
	hour: number;
	minute: number;
	month: string;
	year: string;
}

function localParts(now: Date, tz: string): LocalParts {
	const parts = new Intl.DateTimeFormat("en-CA", {
		day: "2-digit",
		hour: "2-digit",
		hour12: false,
		minute: "2-digit",
		month: "2-digit",
		timeZone: tz,
		year: "numeric",
	}).formatToParts(now);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
	return {
		day: get("day"),
		// Intl renders midnight as "24" in some engines.
		hour: Number(get("hour")) % 24,
		minute: Number(get("minute")),
		month: get("month"),
		year: get("year"),
	};
}

/** Local calendar day in the scheduler timezone, YYYY-MM-DD. */
export function localDateKey(now: Date, tz: string): string {
	const p = localParts(now, tz);
	return `${p.year}-${p.month}-${p.day}`;
}

function localMinutes(now: Date, tz: string): number {
	const p = localParts(now, tz);
	return p.hour * MINUTES_PER_HOUR + p.minute;
}

/**
 * The summary is due from 07:30 local until noon, once per local day. The
 * window (rather than one exact minute) lets a restart or a busy tick still
 * send it; `lastSentOn` keeps it to one mail a day.
 */
export function isDailySummaryDue(
	cfg: { enabled: boolean; lastSentOn: string | null },
	now: Date,
	tz: string,
): boolean {
	if (!cfg.enabled) return false;
	const minutes = localMinutes(now, tz);
	const start = DAILY_SUMMARY_HOUR * MINUTES_PER_HOUR + DAILY_SUMMARY_MINUTE;
	const end = DAILY_SUMMARY_WINDOW_END_HOUR * MINUTES_PER_HOUR;
	if (minutes < start || minutes >= end) return false;
	return cfg.lastSentOn !== localDateKey(now, tz);
}

/**
 * Before 09:30 local a summary waits for the workspace's still-running rank
 * checks and auto-research, so it reports their results instead of
 * yesterday's.
 */
export function mayWaitForJobs(now: Date, tz: string): boolean {
	return (
		localMinutes(now, tz) <
		DAILY_SUMMARY_WAIT_UNTIL_HOUR * MINUTES_PER_HOUR +
			DAILY_SUMMARY_WAIT_UNTIL_MINUTE
	);
}

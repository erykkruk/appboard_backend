/** Local calendar day ("YYYY-MM-DD") and hour/minute in a timezone. */
export function localClock(
	now: Date,
	tz: string,
): { day: string; hour: number; minute: number } {
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
		day: `${get("year")}-${get("month")}-${get("day")}`,
		// Some runtimes format midnight as "24" with hour12: false.
		hour: Number(get("hour")) % 24,
		minute: Number(get("minute")),
	};
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `from` to `to`, both "YYYY-MM-DD". */
export function daysBetween(from: string, to: string): number {
	return Math.round(
		(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
	);
}

import { describe, expect, it } from "bun:test";
import {
	isAutoResearchDue,
	isRankCheckDue,
	localDayNumber,
	localHourMinute,
	marketsForResearchRun,
	nextAutoResearchAt,
	primaryResearchMarket,
	RANK_CHECK_MIN_GAP_MS_BY_STORE,
	rankedKeywordsByCountry,
} from "@/modules/tracking/scheduler.service";
import {
	RANK_CHECK_HOURS_BY_STORE,
	RESEARCH_ROTATION_DAYS,
} from "@/modules/tracking/tracking.types";

const TZ = "UTC";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const at = (iso: string) => new Date(iso);

describe("localHourMinute", () => {
	it("reads hour/minute in the given timezone", () => {
		expect(localHourMinute(at("2026-07-10T12:00:00Z"), TZ)).toEqual({
			hour: 12,
			minute: 0,
		});
		expect(localHourMinute(at("2026-07-10T00:00:00Z"), TZ)).toEqual({
			hour: 0,
			minute: 0,
		});
	});

	it("shifts by the timezone offset", () => {
		// 00:00 UTC is 02:00 in Warsaw (CEST, +2).
		expect(
			localHourMinute(at("2026-07-10T00:00:00Z"), "Europe/Warsaw"),
		).toEqual({ hour: 2, minute: 0 });
	});
});

describe("isRankCheckDue", () => {
	const appstore = (lastRankCheckAt: Date | null) => ({
		lastRankCheckAt,
		store: "appstore" as const,
	});
	const playstore = (lastRankCheckAt: Date | null) => ({
		lastRankCheckAt,
		store: "playstore" as const,
	});

	it("fires at 00:00 and 12:00 for the App Store when never run", () => {
		expect(isRankCheckDue(appstore(null), at("2026-07-10T00:00:00Z"), TZ)).toBe(
			true,
		);
		expect(isRankCheckDue(appstore(null), at("2026-07-10T12:00:00Z"), TZ)).toBe(
			true,
		);
	});

	it("fires at 00:00 and the 03:00 catch-up slot for Google Play", () => {
		expect(
			isRankCheckDue(playstore(null), at("2026-07-10T00:00:00Z"), TZ),
		).toBe(true);
		// The 00:00 run the store stopped never set lastRankCheckAt: 03:00 runs.
		expect(
			isRankCheckDue(
				playstore(at("2026-07-09T01:40:00Z")),
				at("2026-07-10T03:00:00Z"),
				TZ,
			),
		).toBe(true);
		// A 00:00 run that finished at 01:45 is inside the 2 h guard.
		expect(
			isRankCheckDue(
				playstore(at("2026-07-10T01:45:00Z")),
				at("2026-07-10T03:00:00Z"),
				TZ,
			),
		).toBe(false);
		expect(
			isRankCheckDue(playstore(null), at("2026-07-10T12:00:00Z"), TZ),
		).toBe(false);
		expect(
			isRankCheckDue(
				playstore(at("2026-07-09T00:40:00Z")),
				at("2026-07-10T00:00:00Z"),
				TZ,
			),
		).toBe(true);
	});

	it("a manual Play check in the evening does not skip the 00:00 slot", () => {
		// Manual check finished 19:00, next slot 00:00: Play still runs.
		expect(
			isRankCheckDue(
				playstore(at("2026-07-09T19:00:00Z")),
				at("2026-07-10T00:00:00Z"),
				TZ,
			),
		).toBe(true);
		// The App Store keeps its 6 h guard between its two slots.
		expect(
			isRankCheckDue(
				appstore(at("2026-07-09T19:00:00Z")),
				at("2026-07-10T00:00:00Z"),
				TZ,
			),
		).toBe(false);
	});

	it("dedupes a double tick at the Play 00:00 slot", () => {
		const slot = at("2026-07-10T00:00:00Z");
		const justRan = new Date(slot.getTime() - 30_000);
		expect(isRankCheckDue(playstore(justRan), slot, TZ)).toBe(false);
		expect(
			isRankCheckDue(
				playstore(new Date(slot.getTime() - 90 * 60_000)),
				slot,
				TZ,
			),
		).toBe(false);
		expect(RANK_CHECK_MIN_GAP_MS_BY_STORE.playstore).toBe(2 * HOUR);
	});

	it("keeps the slots in one named table", () => {
		expect(RANK_CHECK_HOURS_BY_STORE.appstore).toEqual([0, 12]);
		expect(RANK_CHECK_HOURS_BY_STORE.playstore).toEqual([0, 3]);
	});

	it("does not fire off-slot", () => {
		expect(isRankCheckDue(appstore(null), at("2026-07-10T12:30:00Z"), TZ)).toBe(
			false,
		);
		expect(isRankCheckDue(appstore(null), at("2026-07-10T06:00:00Z"), TZ)).toBe(
			false,
		);
	});

	it("is idempotent within a slot (6h gap)", () => {
		const now = at("2026-07-10T12:00:00Z");
		expect(isRankCheckDue(appstore(at("2026-07-10T11:00:00Z")), now, TZ)).toBe(
			false,
		);
		expect(
			isRankCheckDue(appstore(new Date(now.getTime() - 7 * HOUR)), now, TZ),
		).toBe(true);
	});
});

describe("isAutoResearchDue", () => {
	// The slot is 06:00 local; with TZ = UTC that is 06:00Z.
	const slot = at("2026-07-10T06:00:00Z");

	it("only evaluates at 06:00", () => {
		expect(
			isAutoResearchDue(
				{ autoResearchFrequency: "daily", lastAutoResearchAt: null },
				at("2026-07-10T00:00:00Z"),
				TZ,
			),
		).toBe(false);
		expect(
			isAutoResearchDue(
				{ autoResearchFrequency: "daily", lastAutoResearchAt: null },
				slot,
				TZ,
			),
		).toBe(true);
	});

	it("respects the daily interval", () => {
		expect(
			isAutoResearchDue(
				{
					autoResearchFrequency: "daily",
					lastAutoResearchAt: new Date(slot.getTime() - 2 * DAY),
				},
				slot,
				TZ,
			),
		).toBe(true);
		expect(
			isAutoResearchDue(
				{
					autoResearchFrequency: "daily",
					lastAutoResearchAt: new Date(slot.getTime() - 12 * HOUR),
				},
				slot,
				TZ,
			),
		).toBe(false);
	});

	it("respects the weekly interval", () => {
		expect(
			isAutoResearchDue(
				{
					autoResearchFrequency: "weekly",
					lastAutoResearchAt: new Date(slot.getTime() - 3 * DAY),
				},
				slot,
				TZ,
			),
		).toBe(false);
		expect(
			isAutoResearchDue(
				{
					autoResearchFrequency: "weekly",
					lastAutoResearchAt: new Date(slot.getTime() - 8 * DAY),
				},
				slot,
				TZ,
			),
		).toBe(true);
	});
});

describe("marketsForResearchRun", () => {
	const countries = [
		"us",
		"pl",
		"de",
		"es",
		"gb",
		"fr",
		"it",
		"nl",
		"se",
		"no",
	];

	it("covers every market in one weekly or monthly run", () => {
		expect(marketsForResearchRun(countries, "weekly", 0)).toHaveLength(10);
		expect(marketsForResearchRun(countries, "monthly", 3)).toHaveLength(10);
	});

	it("covers every market exactly once across a daily rotation", () => {
		const seen: string[] = [];
		for (let day = 100; day < 100 + RESEARCH_ROTATION_DAYS; day++) {
			seen.push(...marketsForResearchRun(countries, "daily", day));
		}
		expect(seen.sort()).toEqual([...countries].sort());
	});

	it("dedupes and lowercases country codes", () => {
		expect(marketsForResearchRun(["US", "us", "pl"], "weekly", 0)).toEqual([
			"pl",
			"us",
		]);
	});
});

describe("primaryResearchMarket", () => {
	const tracked = [
		{ country: "us" },
		{ country: "pl" },
		{ country: "pl" },
		{ country: "de" },
	];

	it("prefers the home storefront when it is tracked", () => {
		expect(primaryResearchMarket(tracked, "US")).toBe("us");
	});

	it("falls back to the market with most keywords", () => {
		expect(primaryResearchMarket(tracked, "fr")).toBe("pl");
		expect(primaryResearchMarket(tracked, null)).toBe("pl");
	});

	it("uses us when nothing is tracked", () => {
		expect(primaryResearchMarket([], null)).toBe("us");
	});

	it("prefers the market where most keywords rank over the alphabet", () => {
		const atCap = [
			{ country: "be" },
			{ country: "be" },
			{ country: "pl" },
			{ country: "pl" },
		];
		expect(primaryResearchMarket(atCap, null)).toBe("be");
		expect(
			primaryResearchMarket(
				atCap,
				null,
				new Map([
					["be", 1],
					["pl", 9],
				]),
			),
		).toBe("pl");
	});

	it("still prefers the home storefront over rankings", () => {
		expect(primaryResearchMarket(tracked, "de", new Map([["pl", 9]]))).toBe(
			"de",
		);
	});
});

describe("rankedKeywordsByCountry", () => {
	it("counts keywords whose newest measurement ranks", () => {
		const older = new Date("2026-11-03T00:00:00Z");
		const newer = new Date("2026-11-04T00:00:00Z");
		const ranked = rankedKeywordsByCountry([
			{ country: "PL", createdAt: newer, keyword: "quiz", position: 3 },
			{ country: "pl", createdAt: older, keyword: "quiz", position: null },
			{ country: "pl", createdAt: newer, keyword: "mafia", position: null },
			{ country: "pl", createdAt: older, keyword: "mafia", position: 20 },
			{ country: "be", createdAt: newer, keyword: "quiz", position: 40 },
		]);
		expect(Object.fromEntries(ranked)).toEqual({ be: 1, pl: 1 });
	});
});

describe("localDayNumber", () => {
	it("follows the local calendar date, not the UTC one", () => {
		// 23:30Z on the 9th is already the 10th in Warsaw (CEST, +2).
		const late = at("2026-07-09T23:30:00Z");
		expect(localDayNumber(late, "Europe/Warsaw")).toBe(
			localDayNumber(late, "UTC") + 1,
		);
	});
});

describe("nextAutoResearchAt", () => {
	it("is null when auto-research is off", () => {
		expect(
			nextAutoResearchAt(
				{
					autoResearchEnabled: false,
					autoResearchFrequency: "daily",
					lastAutoResearchAt: null,
				},
				at("2026-07-10T08:00:00Z"),
				TZ,
			),
		).toBeNull();
	});

	it("is the next 06:00 for a daily run", () => {
		expect(
			nextAutoResearchAt(
				{
					autoResearchEnabled: true,
					autoResearchFrequency: "daily",
					lastAutoResearchAt: at("2026-07-10T06:00:00Z"),
				},
				at("2026-07-10T08:15:00Z"),
				TZ,
			)?.toISOString(),
		).toBe("2026-07-11T06:00:00.000Z");
	});

	it("waits out the weekly interval", () => {
		expect(
			nextAutoResearchAt(
				{
					autoResearchEnabled: true,
					autoResearchFrequency: "weekly",
					lastAutoResearchAt: at("2026-07-10T06:00:00Z"),
				},
				at("2026-07-10T08:15:00Z"),
				TZ,
			)?.toISOString(),
		).toBe("2026-07-17T06:00:00.000Z");
	});

	it("can be today when the slot has not passed yet", () => {
		expect(
			nextAutoResearchAt(
				{
					autoResearchEnabled: true,
					autoResearchFrequency: "daily",
					lastAutoResearchAt: null,
				},
				at("2026-07-10T05:59:00Z"),
				TZ,
			)?.toISOString(),
		).toBe("2026-07-10T06:00:00.000Z");
	});
});

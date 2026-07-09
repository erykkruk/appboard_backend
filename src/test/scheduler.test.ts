import { describe, expect, it } from "bun:test";
import {
	isAutoResearchDue,
	isRankCheckDue,
	localHourMinute,
} from "@/modules/tracking/scheduler.service";

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
	it("fires at 00:00 and 12:00 when never run", () => {
		expect(
			isRankCheckDue({ lastRankCheckAt: null }, at("2026-07-10T00:00:00Z"), TZ),
		).toBe(true);
		expect(
			isRankCheckDue({ lastRankCheckAt: null }, at("2026-07-10T12:00:00Z"), TZ),
		).toBe(true);
	});

	it("does not fire off-slot", () => {
		expect(
			isRankCheckDue({ lastRankCheckAt: null }, at("2026-07-10T12:30:00Z"), TZ),
		).toBe(false);
		expect(
			isRankCheckDue({ lastRankCheckAt: null }, at("2026-07-10T06:00:00Z"), TZ),
		).toBe(false);
	});

	it("is idempotent within a slot (6h gap)", () => {
		const now = at("2026-07-10T12:00:00Z");
		expect(
			isRankCheckDue({ lastRankCheckAt: at("2026-07-10T11:00:00Z") }, now, TZ),
		).toBe(false);
		expect(
			isRankCheckDue(
				{ lastRankCheckAt: new Date(now.getTime() - 7 * HOUR) },
				now,
				TZ,
			),
		).toBe(true);
	});
});

describe("isAutoResearchDue", () => {
	const midnight = at("2026-07-10T00:00:00Z");

	it("only evaluates at midnight", () => {
		expect(
			isAutoResearchDue(
				{ autoResearchFrequency: "daily", lastAutoResearchAt: null },
				at("2026-07-10T12:00:00Z"),
				TZ,
			),
		).toBe(false);
		expect(
			isAutoResearchDue(
				{ autoResearchFrequency: "daily", lastAutoResearchAt: null },
				midnight,
				TZ,
			),
		).toBe(true);
	});

	it("respects the daily interval", () => {
		expect(
			isAutoResearchDue(
				{
					autoResearchFrequency: "daily",
					lastAutoResearchAt: new Date(midnight.getTime() - 2 * DAY),
				},
				midnight,
				TZ,
			),
		).toBe(true);
		expect(
			isAutoResearchDue(
				{
					autoResearchFrequency: "daily",
					lastAutoResearchAt: new Date(midnight.getTime() - 12 * HOUR),
				},
				midnight,
				TZ,
			),
		).toBe(false);
	});

	it("respects the weekly interval", () => {
		expect(
			isAutoResearchDue(
				{
					autoResearchFrequency: "weekly",
					lastAutoResearchAt: new Date(midnight.getTime() - 3 * DAY),
				},
				midnight,
				TZ,
			),
		).toBe(false);
		expect(
			isAutoResearchDue(
				{
					autoResearchFrequency: "weekly",
					lastAutoResearchAt: new Date(midnight.getTime() - 8 * DAY),
				},
				midnight,
				TZ,
			),
		).toBe(true);
	});
});

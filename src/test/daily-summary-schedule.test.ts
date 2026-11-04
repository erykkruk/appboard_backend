import { describe, expect, it } from "bun:test";
import {
	isDailySummaryDue,
	localDateKey,
	mayWaitForJobs,
} from "@/modules/daily-summary/daily-summary.schedule";

const WARSAW = "Europe/Warsaw";
const at = (iso: string) => new Date(iso);
const on = { enabled: true, lastSentOn: null };

describe("localDateKey", () => {
	it("uses the local calendar day, not the UTC one", () => {
		// 23:30 UTC on 3 Nov is 00:30 on 4 Nov in Warsaw (CET, +1).
		expect(localDateKey(at("2026-11-03T23:30:00Z"), WARSAW)).toBe("2026-11-04");
		expect(localDateKey(at("2026-11-03T23:30:00Z"), "UTC")).toBe("2026-11-03");
	});
});

describe("isDailySummaryDue", () => {
	it("fires from 07:30 local in winter (CET, +1)", () => {
		expect(isDailySummaryDue(on, at("2026-11-04T06:29:00Z"), WARSAW)).toBe(
			false,
		);
		expect(isDailySummaryDue(on, at("2026-11-04T06:30:00Z"), WARSAW)).toBe(
			true,
		);
	});

	it("fires from 07:30 local in summer (CEST, +2)", () => {
		expect(isDailySummaryDue(on, at("2026-07-10T05:29:00Z"), WARSAW)).toBe(
			false,
		);
		expect(isDailySummaryDue(on, at("2026-07-10T05:30:00Z"), WARSAW)).toBe(
			true,
		);
	});

	it("stays due through the morning so a restart still sends, but not after noon", () => {
		expect(isDailySummaryDue(on, at("2026-11-04T09:45:00Z"), WARSAW)).toBe(
			true,
		);
		expect(isDailySummaryDue(on, at("2026-11-04T10:59:00Z"), WARSAW)).toBe(
			true,
		);
		expect(isDailySummaryDue(on, at("2026-11-04T11:00:00Z"), WARSAW)).toBe(
			false,
		);
	});

	it("is not due again on a day it was already sent (restart at 07:30)", () => {
		const sent = { enabled: true, lastSentOn: "2026-11-04" };
		expect(isDailySummaryDue(sent, at("2026-11-04T06:30:00Z"), WARSAW)).toBe(
			false,
		);
		expect(isDailySummaryDue(sent, at("2026-11-04T06:31:00Z"), WARSAW)).toBe(
			false,
		);
		// The next morning it is due again.
		expect(isDailySummaryDue(sent, at("2026-11-05T06:30:00Z"), WARSAW)).toBe(
			true,
		);
	});

	it("never fires when disabled", () => {
		expect(
			isDailySummaryDue(
				{ enabled: false, lastSentOn: null },
				at("2026-11-04T06:30:00Z"),
				WARSAW,
			),
		).toBe(false);
	});
});

describe("mayWaitForJobs", () => {
	it("waits for running jobs until 09:30 local, then sends anyway", () => {
		expect(mayWaitForJobs(at("2026-11-04T08:29:00Z"), WARSAW)).toBe(true);
		expect(mayWaitForJobs(at("2026-11-04T08:30:00Z"), WARSAW)).toBe(false);
	});
});

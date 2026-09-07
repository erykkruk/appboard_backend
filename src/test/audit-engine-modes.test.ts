import { describe, expect, it } from "bun:test";
import { buildAudit } from "@/modules/research/listing-audit";
import type { KeywordScore } from "@/modules/research/scoring-types";
import {
	isAuditRefreshDue,
	localWeekday,
} from "@/modules/tracking/scheduler.service";

describe("audit without keyword data", () => {
	const app = {
		country: "us",
		description: "Short blurb.",
		genre: "Games",
		name: "Party Quiz",
		screenshots: 2,
	};

	// One popular, easy term the app is absent from: enough for the keyword
	// rules ("title has no keyword", "missing winnable term") to fire.
	const scores = [
		{
			appRank: null,
			classification: "sweet-spot",
			competitors: [],
			country: "us",
			difficulty: 20,
			error: undefined,
			keyword: "trivia night",
			opportunity: 60,
			popularity: 55,
		},
	] as unknown as KeywordScore[];

	it("keeps the text and screenshot rules and drops every keyword rule", () => {
		const withKeywords = buildAudit(app, scores);
		const without = buildAudit(app, scores, { keywordsUnavailable: true });

		const dropped = withKeywords.issues
			.map((i) => i.id)
			.filter((id) => !without.issues.some((i) => i.id === id));
		expect(dropped.length).toBeGreaterThan(0);
		for (const id of dropped) {
			expect(
				id.startsWith("title-") ||
					id.includes("ranks") ||
					id === "missing-winnable-terms",
			).toBe(true);
		}
		expect(without.issues.map((i) => i.id)).toEqual(
			expect.arrayContaining(["screenshots", "description-short"]),
		);
		expect(without.asoScore).toBeGreaterThan(withKeywords.asoScore);
	});
});

describe("weekly audit sweep", () => {
	const tz = "Europe/Warsaw";

	it("knows the local weekday", () => {
		// 2026-09-07 is a Monday in Warsaw.
		expect(localWeekday(new Date("2026-09-07T10:00:00Z"), tz)).toBe(1);
		expect(localWeekday(new Date("2026-09-06T10:00:00Z"), tz)).toBe(0);
	});

	it("fires only on Monday 03:00 local", () => {
		expect(isAuditRefreshDue(new Date("2026-09-07T01:00:00Z"), tz)).toBe(true);
		expect(isAuditRefreshDue(new Date("2026-09-07T01:01:00Z"), tz)).toBe(false);
		expect(isAuditRefreshDue(new Date("2026-09-08T01:00:00Z"), tz)).toBe(false);
		expect(isAuditRefreshDue(new Date("2026-09-07T03:00:00Z"), tz)).toBe(false);
	});
});

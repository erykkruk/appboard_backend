import { afterEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { publicReportsController } from "@/modules/public-reports";
import { db } from "@/utils/db";
import { publicAsoReports, publicKeywordObservations } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
// Side-effect import: boots the app once (runs DB migrations) for the suite.
import "./setup";

const app = new Elysia().use(errorHandler).use(publicReportsController);

const TRACK_ID = "999000111";

function post(body: unknown) {
	return app.handle(
		new Request("http://localhost/api/public/aso-reports", {
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		}),
	);
}

function validReport() {
	return {
		appName: "Habitly",
		asoScore: 58,
		country: "us",
		keywords: [
			{
				appRank: 12,
				classification: "sweet-spot",
				difficulty: 30,
				keyword: "Habit Streak",
				opportunity: 55,
				popularity: 41,
			},
			{
				classification: "hidden-gem",
				difficulty: 22,
				keyword: "daily routine planner",
				opportunity: 40,
				popularity: 34,
			},
		],
		trackId: TRACK_ID,
	};
}

async function cleanup() {
	const reports = await db
		.select({ id: publicAsoReports.id })
		.from(publicAsoReports)
		.where(eq(publicAsoReports.trackId, TRACK_ID));
	for (const r of reports) {
		await db.delete(publicAsoReports).where(eq(publicAsoReports.id, r.id));
	}
}

afterEach(cleanup);

describe("POST /api/public/aso-reports", () => {
	it("stores a report with normalized keyword observations, no auth needed", async () => {
		const res = await post(validReport());
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			keywordsStored: number;
			success: boolean;
		};
		expect(body.success).toBe(true);
		expect(body.keywordsStored).toBe(2);

		const [report] = await db
			.select()
			.from(publicAsoReports)
			.where(eq(publicAsoReports.trackId, TRACK_ID));
		expect(report.country).toBe("us");
		expect(report.asoScore).toBe(58);
		expect(report.source).toBe("web_client");
		expect(report.ipHash).toHaveLength(64);

		const observations = await db
			.select()
			.from(publicKeywordObservations)
			.where(eq(publicKeywordObservations.reportId, report.id));
		expect(observations).toHaveLength(2);
		const streak = observations.find((o) => o.keyword === "habit streak");
		expect(streak?.appRank).toBe(12);
		expect(streak?.popularity).toBe(41);
	});

	it("drops duplicate and invalid-classification keywords", async () => {
		const report = validReport();
		report.keywords.push(
			{
				classification: "sweet-spot",
				difficulty: 30,
				keyword: "habit streak",
				opportunity: 55,
				popularity: 41,
			},
			{
				classification: "made-up-label",
				difficulty: 10,
				keyword: "bogus",
				opportunity: 10,
				popularity: 10,
			},
		);
		const res = await post(report);
		const body = (await res.json()) as { keywordsStored: number };
		expect(body.keywordsStored).toBe(2);
	});

	it("rejects out-of-range and malformed payloads", async () => {
		const badScore = validReport();
		badScore.keywords[0].difficulty = 250;
		expect((await post(badScore)).status).toBe(422);

		const badTrack = validReport();
		badTrack.trackId = "not-a-number";
		expect((await post(badTrack)).status).toBe(422);

		const tooMany = validReport();
		tooMany.keywords = Array.from({ length: 21 }, (_, i) => ({
			classification: "moderate",
			difficulty: 10,
			keyword: `kw${i}`,
			opportunity: 10,
			popularity: 10,
		}));
		expect((await post(tooMany)).status).toBe(422);

		expect(
			(await post({ country: "us", keywords: [], trackId: "123" })).status,
		).toBe(422);
	});
});

describe("scoring engine stays browser-safe", () => {
	it("scoring-types.ts and keyword-scoring.ts have no runtime imports", async () => {
		const types = await Bun.file(
			"src/modules/research/scoring-types.ts",
		).text();
		const engine = await Bun.file(
			"src/modules/research/keyword-scoring.ts",
		).text();
		// Types must be fully self-contained; the engine may import ONLY its
		// own types module (type-only, erased at compile time).
		expect(types).not.toMatch(/^import /m);
		const engineImports =
			engine.match(/^import(?:\s+type)?[\s\S]*?from\s+"[^"]+";/gm) ?? [];
		expect(engineImports).toHaveLength(1);
		expect(engineImports[0]).toContain('from "./scoring-types"');
		expect(engineImports[0].startsWith("import type")).toBe(true);
	});
});

import { afterEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { publicReportsController } from "@/modules/public-reports";
import { db } from "@/utils/db";
import {
	publicAsoReports,
	publicKeywordObservations,
	publicToolUsage,
} from "@/utils/db/schema";
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
		.where(eq(publicAsoReports.appName, "Habitly"));
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

	it("accepts a keyword-only check with no app (difficulty checker)", async () => {
		const { trackId: _omitted, ...keywordOnly } = validReport();
		const res = await post(keywordOnly);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { keywordsStored: number };
		expect(body.keywordsStored).toBe(2);
	});

	it("rejects out-of-range and malformed payloads", async () => {
		const badScore = validReport();
		badScore.keywords[0].difficulty = 250;
		expect((await post(badScore)).status).toBe(422);

		const badTrack = validReport();
		badTrack.trackId = "has spaces!";
		expect((await post(badTrack)).status).toBe(422);

		// Play package names are valid track ids since Play support landed.
		const playReport = { ...validReport(), trackId: "999000111" };
		expect((await post(playReport)).status).toBe(200);

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
		expect(engineImports[0]?.startsWith("import type")).toBe(true);
	});

	it("listing-suggestions.ts imports only engine types", async () => {
		const src = await Bun.file(
			"src/modules/research/listing-suggestions.ts",
		).text();
		const imports =
			src.match(/^import(?:\s+type)?[\s\S]*?from\s+"[^"]+";/gm) ?? [];
		expect(imports.length).toBeGreaterThan(0);
		for (const line of imports) {
			expect(line.startsWith("import type")).toBe(true);
			expect(/from "\.\/(scoring-types|listing-audit)";$/.test(line)).toBe(
				true,
			);
		}
	});

	it("listing-audit.ts has no runtime imports either", async () => {
		const audit = await Bun.file(
			"src/modules/research/listing-audit.ts",
		).text();
		const auditImports =
			audit.match(/^import(?:\s+type)?[\s\S]*?from\s+"[^"]+";/gm) ?? [];
		expect(auditImports).toHaveLength(1);
		expect(auditImports[0]).toContain('from "./scoring-types"');
		expect(auditImports[0]?.startsWith("import type")).toBe(true);
	});
});

describe("free-tool daily quota", () => {
	const ip = "203.0.113.77";

	function quotaRequest(path: string, init?: RequestInit, cookie?: string) {
		const headers = new Headers(init?.headers);
		headers.set("x-forwarded-for", ip);
		if (cookie) headers.set("cookie", cookie);
		if (init?.body) headers.set("Content-Type", "application/json");
		return app.handle(
			new Request(`http://localhost${path}`, { ...init, headers }),
		);
	}

	afterEach(async () => {
		await db
			.delete(publicToolUsage)
			.where(eq(publicToolUsage.subjectKind, "ip"));
		await db
			.delete(publicToolUsage)
			.where(eq(publicToolUsage.subjectKind, "cookie"));
	});

	it("reports the daily allowance and mints a cookie", async () => {
		const res = await quotaRequest("/api/public/quota");
		expect(res.status).toBe(200);
		expect(res.headers.get("set-cookie")).toContain("ab_free_tools=");
		const body = (await res.json()) as Record<
			string,
			{ limit: number; remaining: number }
		>;
		expect(body["aso-check"].limit).toBe(2);
		expect(body["keyword-check"].limit).toBe(5);
		expect(body["keyword-check"].remaining).toBe(5);
	});

	it("consumes units and refuses once the day's allowance is gone", async () => {
		const first = await quotaRequest("/api/public/quota/consume", {
			body: JSON.stringify({ tool: "keyword-check", units: 4 }),
			method: "POST",
		});
		expect(first.status).toBe(200);
		expect(((await first.json()) as { remaining: number }).remaining).toBe(1);

		const tooMany = await quotaRequest("/api/public/quota/consume", {
			body: JSON.stringify({ tool: "keyword-check", units: 3 }),
			method: "POST",
		});
		expect(tooMany.status).toBe(429);
		const body = (await tooMany.json()) as {
			allowed: boolean;
			remaining: number;
		};
		expect(body.allowed).toBe(false);
		// Nothing was consumed by the refused call.
		expect(body.remaining).toBe(1);

		const last = await quotaRequest("/api/public/quota/consume", {
			body: JSON.stringify({ tool: "keyword-check", units: 1 }),
			method: "POST",
		});
		expect(((await last.json()) as { remaining: number }).remaining).toBe(0);
	});

	it("keeps counting the same IP even with a fresh cookie", async () => {
		await quotaRequest("/api/public/quota/consume", {
			body: JSON.stringify({ tool: "aso-check", units: 2 }),
			method: "POST",
		});
		// A brand-new cookie id: the hashed IP still carries the count.
		const res = await quotaRequest(
			"/api/public/quota/consume",
			{ body: JSON.stringify({ tool: "aso-check" }), method: "POST" },
			"ab_free_tools=00000000-0000-4000-8000-000000000000",
		);
		expect(res.status).toBe(429);
	});

	it("tracks tools independently", async () => {
		await quotaRequest("/api/public/quota/consume", {
			body: JSON.stringify({ tool: "aso-check", units: 2 }),
			method: "POST",
		});
		const res = await quotaRequest("/api/public/quota/consume", {
			body: JSON.stringify({ tool: "keyword-check", units: 5 }),
			method: "POST",
		});
		expect(res.status).toBe(200);
	});
});

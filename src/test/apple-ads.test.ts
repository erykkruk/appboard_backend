import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { appleAdsController } from "@/modules/apple-ads";
import {
	buildClientSecret,
	latestAvailableWeek,
	weekStartSunday,
} from "@/modules/apple-ads/apple-ads.client";
import {
	AppleAdsService,
	cleanTopTermRows,
	inferAppleGenre,
	mapItunesGenre,
	weekSanityIssue,
} from "@/modules/apple-ads/apple-ads.service";
import { ResearchService } from "@/modules/research/research.service";
import { SettingsService } from "@/modules/settings/settings.service";
import { db } from "@/utils/db";
import { appleDatasetWeeks, appleTopTerms } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
import { authGuard, authRequest, getTestWorkspaceId } from "./setup";

const TEST_WORKSPACE_ID = getTestWorkspaceId();

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(appleAdsController));

describe("buildClientSecret", () => {
	it("produces a verifiable ES256 JWT with the expected claims", () => {
		const { privateKey, publicKey } = generateKeyPairSync("ec", {
			namedCurve: "P-256",
			privateKeyEncoding: { format: "pem", type: "pkcs8" },
			publicKeyEncoding: { format: "pem", type: "spki" },
		});
		const jwt = buildClientSecret({
			clientId: "SEARCHADS.client",
			keyId: "key-1",
			privateKey,
			teamId: "SEARCHADS.team",
		});
		const [headerB64, payloadB64, signatureB64] = jwt.split(".");
		const header = JSON.parse(
			Buffer.from(headerB64, "base64url").toString(),
		) as { alg: string; kid: string };
		expect(header.alg).toBe("ES256");
		expect(header.kid).toBe("key-1");
		const payload = JSON.parse(
			Buffer.from(payloadB64, "base64url").toString(),
		) as { aud: string; exp: number; iat: number; iss: string; sub: string };
		expect(payload.sub).toBe("SEARCHADS.client");
		expect(payload.iss).toBe("SEARCHADS.team");
		expect(payload.aud).toBe("https://appleid.apple.com");
		expect(payload.exp - payload.iat).toBe(3600);

		const verifier = createVerify("sha256");
		verifier.update(`${headerB64}.${payloadB64}`);
		expect(
			verifier.verify(
				{ dsaEncoding: "ieee-p1363", key: publicKey },
				Buffer.from(signatureB64, "base64url"),
			),
		).toBe(true);
	});
});

describe("week math", () => {
	it("weekStartSunday returns the containing week's Sunday", () => {
		expect(weekStartSunday(new Date("2026-08-31T12:00:00Z"))).toBe(
			"2026-08-30",
		); // Monday -> previous Sunday
		expect(weekStartSunday(new Date("2026-08-30T00:00:00Z"))).toBe(
			"2026-08-30",
		); // Sunday -> itself
	});

	it("latestAvailableWeek respects the Monday 07:00 UTC publication", () => {
		// Monday 08:00 UTC: last week's data is out.
		expect(latestAvailableWeek(new Date("2026-08-31T08:00:00Z"))).toBe(
			"2026-08-23",
		);
		// Monday 06:00 UTC: not published yet -> the week before.
		expect(latestAvailableWeek(new Date("2026-08-31T06:00:00Z"))).toBe(
			"2026-08-16",
		);
	});
});

describe("genre mapping", () => {
	it("maps iTunes genres onto Apple buckets (games by prefix)", () => {
		expect(mapItunesGenre("Finance")).toBe("FINANCE");
		expect(mapItunesGenre("Games/Action")).toBe("GAMES");
		expect(mapItunesGenre("Photo & Video")).toBe("PHOTO_VIDEO");
		expect(mapItunesGenre("Nonexistent")).toBeNull();
	});

	it("infers the majority genre from competitors", () => {
		expect(
			inferAppleGenre([
				{ genre: "Finance" },
				{ genre: "Finance" },
				{ genre: "Utilities" },
			]),
		).toBe("FINANCE");
		expect(inferAppleGenre([{ genre: "Unknown Thing" }])).toBeNull();
	});
});

describe("dataset validation", () => {
	it("cleanTopTermRows drops malformed rows and normalizes terms", () => {
		const cleaned = cleanTopTermRows(
			[
				{
					genre: "GAMES",
					rankInGenre: 1,
					searchPopularity1to5: 5,
					searchPopularity1to100: 90,
					searchPopularityInGenre: 99,
					searchTerm: "  Roblox ",
				},
				{ genre: "GAMES", searchTerm: "missing fields" },
				{
					genre: "GAMES",
					rankInGenre: 999,
					searchPopularity1to5: 5,
					searchPopularity1to100: 90,
					searchPopularityInGenre: 99,
					searchTerm: "bad rank",
				},
			],
			"us",
			"2026-08-23",
		);
		expect(cleaned).toHaveLength(1);
		expect(cleaned[0].term).toBe("roblox");
		expect(cleaned[0].popularity).toBe(90);
	});

	it("weekSanityIssue flags tiny or degenerate weeks", () => {
		const row = (term: string, popularity: number, genre = "GAMES") => ({
			country: "us",
			genre,
			popularity,
			popularityInGenre: 50,
			popularityTier: 3,
			rankInGenre: 1,
			term,
			week: "2026-08-23",
		});
		expect(weekSanityIssue([row("a", 50)])).toContain("valid rows");
		const genres = ["A", "B", "C", "D", "E", "F"];
		const healthy = Array.from({ length: 600 }, (_, i) =>
			row(`kw${i}`, 40 + (i % 60), genres[i % genres.length]),
		);
		expect(weekSanityIssue(healthy)).toBe("");
		const constant = Array.from({ length: 600 }, (_, i) =>
			row(`kw${i}`, 42, genres[i % genres.length]),
		);
		expect(weekSanityIssue(constant)).toContain("near-constant");
	});
});

describe("popularity context + dual source", () => {
	const WEEK = "2026-08-23";

	beforeEach(async () => {
		await db
			.insert(appleDatasetWeeks)
			.values({ country: "us", status: "active", termCount: 3, week: WEEK })
			.onConflictDoNothing();
		await db
			.insert(appleTopTerms)
			.values([
				{
					country: "us",
					genre: "HEALTH_FITNESS",
					popularity: 72,
					popularityInGenre: 90,
					popularityTier: 4,
					rankInGenre: 3,
					term: "fitness",
					week: WEEK,
				},
				{
					country: "us",
					genre: "HEALTH_FITNESS",
					popularity: 45,
					popularityInGenre: 40,
					popularityTier: 2,
					rankInGenre: 480,
					term: "stretching",
					week: WEEK,
				},
				{
					country: "us",
					genre: "GAMES",
					popularity: 56,
					popularityInGenre: 30,
					popularityTier: 3,
					rankInGenre: 500,
					term: "idle game",
					week: WEEK,
				},
			])
			.onConflictDoNothing();
	});

	afterEach(async () => {
		await db.delete(appleTopTerms).where(eq(appleTopTerms.week, WEEK));
		await db
			.delete(appleDatasetWeeks)
			.where(
				and(
					eq(appleDatasetWeeks.country, "us"),
					eq(appleDatasetWeeks.week, WEEK),
				),
			);
		await SettingsService.delete(TEST_WORKSPACE_ID, "POPULARITY_SOURCE").catch(
			() => undefined,
		);
	});

	it("returns values and genre floors from the active week", async () => {
		const ctx = await AppleAdsService.popularityContext(
			TEST_WORKSPACE_ID,
			"us",
			["fitness", "unknown term"],
		);
		expect(ctx.hasDataset).toBe(true);
		expect(ctx.values.get("fitness")).toBe(72);
		expect(ctx.values.has("unknown term")).toBe(false);
		// Genre floor: min within the bucket; global floor = min overall.
		expect(ctx.floorFor("HEALTH_FITNESS")).toBe(45);
		expect(ctx.floorFor("GAMES")).toBe(56);
		expect(ctx.floorFor(null)).toBe(45);
		expect(ctx.floorFor("UNSEEN_GENRE")).toBe(45);
	});

	it("keywordScores uses the official value when the apple source is on", async () => {
		await SettingsService.set(TEST_WORKSPACE_ID, "POPULARITY_SOURCE", "apple");
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					results: Array.from({ length: 10 }, (_, i) => ({
						averageUserRating: 4.5,
						primaryGenreName: "Health & Fitness",
						releaseDate: "2019-01-01T00:00:00Z",
						sellerName: `Dev ${i}`,
						trackId: 100 + i,
						trackName: `fitness app ${i}`,
						trackViewUrl: "https://apps.apple.com/us/app/x",
						userRatingCount: 50_000,
					})),
				}),
				{ headers: { "content-type": "application/json" } },
			)) as unknown as typeof fetch;
		try {
			const [score] = await ResearchService.keywordScores(
				["fitness"],
				"us",
				undefined,
				TEST_WORKSPACE_ID,
			);
			expect(score.applePopularity).toBe(72);
			expect(score.popularity).toBe(72);
			expect(score.popularitySource).toBe("apple");
			expect(score.popularityFallback).toBe(false);
			expect(score.internalPopularity).not.toBeNull();
			expect(score.appleGenre).toBe("HEALTH_FITNESS");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("caps the estimate below the genre floor for absent terms", async () => {
		await SettingsService.set(TEST_WORKSPACE_ID, "POPULARITY_SOURCE", "apple");
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					results: Array.from({ length: 10 }, (_, i) => ({
						averageUserRating: 4.5,
						primaryGenreName: "Health & Fitness",
						releaseDate: "2019-01-01T00:00:00Z",
						sellerName: `Dev ${i}`,
						trackId: 100 + i,
						trackName: `posture coach ${i}`,
						trackViewUrl: "https://apps.apple.com/us/app/x",
						userRatingCount: 500_000,
					})),
				}),
				{ headers: { "content-type": "application/json" } },
			)) as unknown as typeof fetch;
		try {
			const [score] = await ResearchService.keywordScores(
				["posture coach"],
				"us",
				undefined,
				TEST_WORKSPACE_ID,
			);
			expect(score.applePopularity).toBeNull();
			expect(score.popularityFallback).toBe(true);
			expect(score.popularitySource).toBe("internal");
			// HEALTH_FITNESS floor is 45 -> cap 44.
			expect(score.popularity).toBeLessThanOrEqual(44);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe("apple-ads endpoints", () => {
	it("rejects unauthenticated requests", async () => {
		const res = await app.handle(
			new Request("http://localhost/api/apple-ads/status"),
		);
		expect(res.status).toBe(401);
	});

	it("status reports not connected for a fresh workspace", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/apple-ads/status"),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			connected: boolean;
			source: string;
		};
		expect(body.connected).toBe(false);
		expect(body.source).toBe("internal");
	});

	it("connect validates required fields", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/apple-ads/connect", {
				body: JSON.stringify({ clientId: "x" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(422);
	});

	it("sync without credentials returns a clear error", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/apple-ads/sync", {
				body: JSON.stringify({ country: "us" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(400);
	});

	it("source toggle round-trips", async () => {
		const patch = await app.handle(
			authRequest("http://localhost/api/apple-ads/source", {
				body: JSON.stringify({ source: "apple" }),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);
		expect(patch.status).toBe(200);
		const status = await app.handle(
			authRequest("http://localhost/api/apple-ads/status"),
		);
		const body = (await status.json()) as { source: string };
		expect(body.source).toBe("apple");
		await SettingsService.delete(TEST_WORKSPACE_ID, "POPULARITY_SOURCE");
	});
});

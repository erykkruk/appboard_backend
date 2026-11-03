import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import {
	AuditService,
	pickListingForMarket,
} from "@/modules/audit/audit.service";
import type { AppAuditReport } from "@/modules/audit/audit.types";
import {
	AuditAiService,
	buildUserPrompt,
	guardKeywordRewrite,
} from "@/modules/audit/audit-ai.service";
import {
	type AuditApp,
	isWinnableScore,
	mergeAuditCandidates,
} from "@/modules/research/listing-audit";
import {
	buildSuggestions,
	keptKeywordTerms,
} from "@/modules/research/listing-suggestions";
import type { KeywordScore } from "@/modules/research/scoring-types";
import { db } from "@/utils/db";
import {
	appAudits,
	apps,
	listings,
	stores,
	trackedKeywords,
} from "@/utils/db/schema";
import { cleanupStores, getTestWorkspaceId } from "./setup";

function score(
	keyword: string,
	overrides: Partial<KeywordScore> = {},
): KeywordScore {
	return {
		appRank: null,
		classification: "good-target",
		difficulty: 30,
		keyword,
		opportunity: 50,
		popularity: 40,
		...overrides,
	} as KeywordScore;
}

describe("pickListingForMarket", () => {
	const rows = [
		{ id: 1, language: "en-US" },
		{ id: 2, language: "en-GB" },
		{ id: 3, language: "pl" },
	];

	it("matches the store locale for a bare language", () => {
		expect(pickListingForMarket(rows, "en", "us")?.id).toBe(1);
	});

	it("prefers the market's regional variant", () => {
		expect(pickListingForMarket(rows, "en", "gb")?.id).toBe(2);
	});

	it("takes an exact language match first", () => {
		expect(pickListingForMarket(rows, "pl", "pl")?.id).toBe(3);
	});

	it("returns null when the language is not synced", () => {
		expect(pickListingForMarket(rows, "de", "de")).toBeNull();
	});
});

describe("mergeAuditCandidates", () => {
	it("puts tracked keywords first, then the keyword field, then the listing", () => {
		const merged = mergeAuditCandidates(
			["Werewolf Game", "party games"],
			"narrator,quiz,party games",
			["focus timer", "quiz"],
			5,
		);
		expect(merged).toEqual([
			"werewolf game",
			"party games",
			"narrator",
			"quiz",
			"focus timer",
		]);
	});
});

describe("isWinnableScore", () => {
	it("uses one threshold for everyone", () => {
		expect(isWinnableScore({ appRank: null, difficulty: 45 })).toBe(true);
		expect(isWinnableScore({ appRank: null, difficulty: 47 })).toBe(false);
		expect(isWinnableScore({ appRank: 30, difficulty: 80 })).toBe(true);
	});
});

describe("keyword field proposal", () => {
	const current =
		"werewolves,narrator,moderator,deduction,quiz,bluffing,bluff,likely,best,friend,know,family,group";

	it("keeps the current terms and only drops measured weak ones", () => {
		const kept = keptKeywordTerms(
			current,
			new Set(["party", "game", "show"]),
			[score("likely", { difficulty: 80, popularity: 10 })],
			[],
		);
		expect(kept).not.toContain("likely");
		expect(kept).toContain("werewolves");
		expect(kept.length).toBe(12);
	});

	it("never drops a word of a tracked phrase", () => {
		const kept = keptKeywordTerms(
			"likely,quiz",
			new Set(),
			[score("likely", { difficulty: 80, popularity: 10 })],
			["most likely to"],
		);
		expect(kept).toEqual(["likely", "quiz"]);
	});

	it("adds a new term to the current field instead of replacing it", () => {
		const suggestions = buildSuggestions(
			{
				keywords: "werewolves,narrator,quiz",
				language: "en-US",
				name: "Buzzin: TV Party Game Show",
				platform: "ios",
				shortDesc: "Werewolf, mafia & trivia night",
			},
			[score("werewolf", { opportunity: 90 }), score("mystery")],
			["werewolf", "mystery"],
			[],
		);
		const field = suggestions.find((s) => s.field === "keywords");
		expect(field?.proposed).toBe("werewolves,narrator,quiz,mystery");
	});
});

describe("guardKeywordRewrite", () => {
	const current = "werewolves,narrator,moderator,deduction,quiz,bluffing";

	it("drops a rewrite that throws the field away", () => {
		expect(guardKeywordRewrite("players", current)).toBeNull();
	});

	it("keeps a rewrite that edits the field", () => {
		const edited = "werewolves,narrator,moderator,deduction,quiz,players";
		expect(guardKeywordRewrite(edited, current)).toBe(edited);
	});

	it("keeps any rewrite when the current field is unknown", () => {
		expect(guardKeywordRewrite("players", undefined)).toBe("players");
	});
});

describe("AI prompt", () => {
	it("shows the synced subtitle and keyword field and marks tracked terms", () => {
		const report = {
			ai: null,
			appId: "a",
			country: "us",
			draft: null,
			keywords: [score("players", { difficulty: 47 }), score("werewolf game")],
			keywordsSupported: true,
			language: "en-US",
			measuredAt: new Date().toISOString(),
			recommendable: ["players", "werewolf game"],
			store: { asoScore: 70, issues: [], strengths: [], themes: [] },
			tracked: ["werewolf game"],
		} as AppAuditReport;
		const listing: AuditApp = {
			country: "us",
			description: "Party games your TV hosts.",
			genre: "Games",
			keywordField: "werewolves,narrator",
			name: "Buzzin: TV Party Game Show",
			screenshots: 8,
			subtitle: "Werewolf, mafia & trivia night",
		};
		const prompt = buildUserPrompt(report, listing);
		expect(prompt).toContain("Subtitle: Werewolf, mafia & trivia night");
		expect(prompt).toContain("Keyword field: werewolves,narrator");
		expect(prompt.indexOf('"werewolf game"')).toBeLessThan(
			prompt.indexOf('"players"'),
		);
		expect(prompt).toContain(
			'"players": popularity 40, difficulty 47, rank none, not winnable',
		);
		expect(prompt).toMatch(/"werewolf game".*winnable, tracked, recommendable/);
	});
});

const APPLE_ID = "555000999";
const realFetch = globalThis.fetch;

function stubItunes() {
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url.includes("/lookup")) {
			return Response.json({
				resultCount: 1,
				results: [
					{
						averageUserRating: 5,
						bundleId: "com.example.party",
						currentVersionReleaseDate: new Date().toISOString(),
						description:
							"Party games your TV hosts. Party games for game night.",
						genres: ["Games"],
						languageCodesISO2A: ["EN"],
						primaryGenreName: "Games",
						screenshotUrls: [],
						trackId: Number(APPLE_ID),
						trackName: "Buzzin: TV Party Game Show",
						userRatingCount: 5,
					},
				],
			});
		}
		return Response.json({ resultCount: 0, results: [] });
	}) as typeof fetch;
}

describe("iOS audit with a synced listing", () => {
	const storeIds: string[] = [];
	afterEach(() => {
		globalThis.fetch = realFetch;
	});
	afterAll(async () => {
		await cleanupStores(storeIds);
	});

	it("audits the synced subtitle and keyword field and scores tracked keywords first", async () => {
		stubItunes();
		const [store] = await db
			.insert(stores)
			.values({
				connectionMode: "public",
				name: "App Store (public)",
				status: "connected",
				type: "app_store",
				workspaceId: getTestWorkspaceId(),
			})
			.returning();
		storeIds.push(store.id);
		const [appRow] = await db
			.insert(apps)
			.values({
				bundleId: "com.example.party",
				externalId: APPLE_ID,
				name: "Buzzin: TV Party Game Show",
				platform: "ios",
				primaryCategory: "Games",
				rawData: { publicCountry: "us" },
				storeId: store.id,
			})
			.returning();
		await db.insert(listings).values({
			appId: appRow.id,
			keywords: "werewolves,narrator",
			language: "en-US",
			shortDesc: "Werewolf, mafia & trivia night",
			source: "remote",
			title: "Buzzin: TV Party Game Show",
		});
		await db.insert(trackedKeywords).values([
			{ appId: appRow.id, country: "us", keyword: "werewolf game" },
			{ appId: appRow.id, country: "us", keyword: "jackbox" },
		]);

		let seen: AuditApp | null = null;
		const spy = spyOn(AuditAiService, "analyze").mockImplementation(
			async (_w, _r, listing) => {
				seen = listing;
				return null;
			},
		);
		try {
			await AuditService.read(appRow.id, getTestWorkspaceId());
			const deadline = Date.now() + 30_000;
			let report: AppAuditReport | null = null;
			while (Date.now() < deadline) {
				const [row] = await db
					.select()
					.from(appAudits)
					.where(eq(appAudits.appId, appRow.id))
					.limit(1);
				if (row?.status === "ready") {
					report = row.report as AppAuditReport;
					break;
				}
				await new Promise((r) => setTimeout(r, 100));
			}
			expect(report).not.toBeNull();
			expect(report?.language).toBe("en-US");
			expect(report?.tracked?.sort()).toEqual(["jackbox", "werewolf game"]);
			expect(
				report?.keywords
					.slice(0, 2)
					.map((k) => k.keyword)
					.sort(),
			).toEqual(["jackbox", "werewolf game"]);
			expect(report?.keywords.map((k) => k.keyword)).toContain("narrator");
			expect(report?.recommendable).toContain("jackbox");
			const listing = seen as AuditApp | null;
			expect(listing?.subtitle).toBe("Werewolf, mafia & trivia night");
			expect(listing?.keywordField).toBe("werewolves,narrator");
		} finally {
			spy.mockRestore();
		}
	}, 60_000);
});

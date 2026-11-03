import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { ResearchRunsService } from "@/modules/research/research.runs.service";
import { ResearchService } from "@/modules/research/research.service";
import type {
	KeywordCompetitor,
	KeywordScore,
} from "@/modules/research/scoring-types";
import { trackingController } from "@/modules/tracking";
import {
	runScheduledAutoResearch,
	scoreMarketIdeas,
} from "@/modules/tracking/scheduler.service";
import { KeywordSuggestionsService } from "@/modules/tracking/suggestions.service";
import { TrackingService } from "@/modules/tracking/tracking.service";
import {
	IDEAS_SCORED_PER_MARKET,
	MAX_KEYWORDS_PER_COUNTRY,
} from "@/modules/tracking/tracking.types";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
} from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { db } from "@/utils/db";
import {
	apps,
	keywordScoreSnapshots,
	trackedKeywords,
} from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";

const BASE = "http://localhost/api";
/** A market no other suite writes snapshots in. */
const COUNTRY = "is";
const OWN_ID = "1111111111";
const OWN_NAME = "Buzzer Party: TV Game Show";

const server = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(trackingController));

const storeIds: string[] = [];
let appId: string;

function rival(title: string, genre = "Games"): KeywordCompetitor {
	return { developer: "Rival", genre, title, trackId: title };
}

function payload(keyword: string, competitors: KeywordCompetitor[]) {
	return {
		classification: "moderate",
		competitors,
		country: COUNTRY,
		difficulty: 40,
		keyword,
		opportunity: 50,
		popularity: 30,
	} as unknown as KeywordScore;
}

async function snapshot(
	keyword: string,
	day: string,
	competitors: KeywordCompetitor[] = [],
	values: { difficulty?: number; popularity?: number } = {},
) {
	await db.insert(keywordScoreSnapshots).values({
		classification: "moderate",
		country: COUNTRY,
		day,
		difficulty: values.difficulty ?? 40,
		keyword,
		opportunity: 50,
		payload: payload(keyword, competitors),
		popularity: values.popularity ?? 30,
		workspaceId: getTestWorkspaceId(),
	});
}

const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
	await db
		.delete(keywordScoreSnapshots)
		.where(eq(keywordScoreSnapshots.country, COUNTRY));
	const store = await seedTestStore();
	storeIds.push(store.id);
	const seeded = await seedTestApp(store.id);
	appId = seeded.id;
	await db
		.update(apps)
		.set({ externalId: OWN_ID, name: OWN_NAME, platform: "ios" })
		.where(eq(apps.id, appId));
	await db.insert(trackedKeywords).values([
		{ appId, country: COUNTRY, keyword: "party game" },
		{ appId, country: COUNTRY, keyword: "trivia night" },
	]);
	// Rival titles name the category twice ("family quiz", "game night"),
	// one off-genre utility must never feed ideas, and our own app is in the
	// list so its genre is known.
	const rivals = [
		{ ...rival("Buzzer Party: TV Game Show"), trackId: OWN_ID },
		rival("QuizCo: Family Quiz & Game Night"),
		rival("Brainy: Family Quiz for Game Night"),
		rival("Mirror: Screen Mirroring Cast", "Utilities"),
		rival("Cast It: Screen Mirroring Cast", "Utilities"),
	];
	await snapshot("party game", today(), rivals);
	await snapshot("trivia night", today(), rivals);
});

afterAll(async () => {
	await db
		.delete(keywordScoreSnapshots)
		.where(eq(keywordScoreSnapshots.country, COUNTRY));
	await cleanupStores(storeIds);
});

describe("KeywordSuggestionsService.forMarket", () => {
	it("mines in-genre rival titles and skips tracked keywords and our brand", async () => {
		const result = await KeywordSuggestionsService.forMarket(
			appId,
			getTestWorkspaceId(),
			COUNTRY.toUpperCase(),
		);
		const ideas = result.suggestions.map((s) => s.keyword);
		expect(ideas).toContain("family quiz");
		expect(ideas).toContain("game night");
		expect(ideas).not.toContain("screen mirroring");
		expect(ideas).not.toContain("party game");
		expect(ideas.some((k) => k.includes("buzzer"))).toBe(false);
		expect(result.cap).toBe(MAX_KEYWORDS_PER_COUNTRY);
		expect(result.trackedCount).toBe(2);
		expect(result.sourceKeywords).toBe(2);
	});

	it("attaches the newest stored score and the winnable verdict", async () => {
		await snapshot("family quiz", "2026-01-01", [], { difficulty: 80 });
		await snapshot("family quiz", today(), [], {
			difficulty: 20,
			popularity: 44,
		});
		const result = await KeywordSuggestionsService.forMarket(
			appId,
			getTestWorkspaceId(),
			COUNTRY,
		);
		const idea = result.suggestions.find((s) => s.keyword === "family quiz");
		expect(idea?.difficulty).toBe(20);
		expect(idea?.popularity).toBe(44);
		expect(idea?.scoredAt).toBe(today());
		expect(idea?.winnable).toBe(true);
		const unscored = result.suggestions.find((s) => s.keyword === "game night");
		expect(unscored?.scoredAt).toBeNull();
		expect(unscored?.winnable).toBeNull();
	});

	it("returns no ideas for a market without tracked keywords", async () => {
		const result = await KeywordSuggestionsService.forMarket(
			appId,
			getTestWorkspaceId(),
			"zz",
		);
		expect(result.suggestions).toEqual([]);
		expect(result.trackedCount).toBe(0);
	});
});

describe("scoreMarketIdeas", () => {
	it("scores only unscored or stale ideas, capped per market", async () => {
		const spy = spyOn(ResearchService, "keywordScores").mockResolvedValue([]);
		try {
			const scored = await scoreMarketIdeas(
				{ appId, workspaceId: getTestWorkspaceId() },
				COUNTRY,
				{ appstoreId: OWN_ID },
			);
			expect(spy).toHaveBeenCalledTimes(1);
			const [terms, country, storeId] = spy.mock.calls[0];
			expect(terms).not.toContain("family quiz");
			expect(terms).toContain("game night");
			expect(terms.length).toBeLessThanOrEqual(IDEAS_SCORED_PER_MARKET);
			expect(country).toBe(COUNTRY);
			expect(storeId).toBe(OWN_ID);
			expect(scored).toBe(terms.length);
		} finally {
			spy.mockRestore();
		}
	});
});

describe("runScheduledAutoResearch", () => {
	it("researches the primary market and scores ideas in every market of a weekly run", async () => {
		const run = spyOn(ResearchRunsService, "runForApp").mockResolvedValue({
			report: {},
			title: OWN_NAME,
		} as unknown as Awaited<ReturnType<typeof ResearchRunsService.runForApp>>);
		const scores = spyOn(ResearchService, "keywordScores").mockResolvedValue(
			[],
		);
		const email = spyOn(
			TrackingService,
			"resolveNotifyEmail",
		).mockResolvedValue(null);
		try {
			await runScheduledAutoResearch({
				appId,
				autoResearchFrequency: "weekly",
				notifyEmail: null,
				workspaceId: getTestWorkspaceId(),
			});
			expect(run).toHaveBeenCalledTimes(1);
			const [, , options] = run.mock.calls[0];
			expect(options.country).toBe(COUNTRY);
			expect(options.kind).toBe("scheduled");
			expect(options.keywords?.sort()).toEqual(["party game", "trivia night"]);
			expect(scores).toHaveBeenCalledTimes(1);
			expect(scores.mock.calls[0][1]).toBe(COUNTRY);
			// Routed through the shared App Store throttle, never unpaced.
			expect(typeof scores.mock.calls[0][4]?.pace).toBe("function");
		} finally {
			run.mockRestore();
			scores.mockRestore();
			email.mockRestore();
		}
	});
});

describe("GET /apps/:id/tracking/suggestions", () => {
	it("returns the market's ideas", async () => {
		const res = await server.handle(
			authRequest(
				`${BASE}/apps/${appId}/tracking/suggestions?country=${COUNTRY}`,
			),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { suggestions: unknown[] };
		expect(body.suggestions.length).toBeGreaterThan(0);
	});

	it("hides another workspace's app", async () => {
		const res = await server.handle(
			authRequestB(
				`${BASE}/apps/${appId}/tracking/suggestions?country=${COUNTRY}`,
			),
		);
		expect(res.status).toBe(404);
	});

	it("returns the schedule with the tracking overview", async () => {
		const res = await server.handle(
			authRequest(`${BASE}/apps/${appId}/tracking`),
		);
		const body = (await res.json()) as {
			schedule: {
				autoResearchHour: number;
				nextAutoResearchAt: string | null;
				rankCheckHours: number[];
			};
		};
		expect(body.schedule.autoResearchHour).toBe(6);
		expect(body.schedule.rankCheckHours).toEqual([0, 12]);
		expect(body.schedule.nextAutoResearchAt).toBeNull();
	});
});

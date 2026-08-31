import Elysia from "elysia";
import { authGuard } from "@/modules/auth";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { KeywordScoresHistoryService } from "./keyword-scores-history.service";
import { ResearchAiService } from "./research.ai";
import { ResearchRunsService } from "./research.runs.service";
import {
	analyzeBody,
	compareBody,
	competitorsBody,
	keywordHistoryQuery,
	keywordScoresBody,
	keywordsBody,
	keywordTrendQuery,
	marketsBody,
	runIdParams,
	saveRunBody,
	scrapeBody,
	searchBody,
	snapshotIdParams,
	visualBody,
} from "./research.schema";
import { ResearchService } from "./research.service";
import type { ResearchRunReport } from "./research.types";

export const researchController = new Elysia({ prefix: "/research" })
	.use(authGuard)
	.post(
		"/search",
		async ({ body }) => {
			const suggestions = await ResearchService.search(
				body.term,
				body.country,
				body.scope ?? "both",
			);
			return { suggestions };
		},
		{
			body: searchBody,
			detail: {
				description: "Typeahead app search across App Store and Google Play",
				tags: ["Research"],
			},
		},
	)
	.post(
		"/scrape",
		async ({ body }) => {
			const target = ResearchService.resolveTarget(body);
			return ResearchService.scrape(target, body.deep ?? false);
		},
		{
			body: scrapeBody,
			detail: {
				description:
					"Fetch store metadata + latest reviews (with keyword heuristics) for any app by URL or store id",
				tags: ["Research"],
			},
		},
	)
	.post(
		"/analyze",
		async ({ body, workspaceId }) => {
			const { analysis, model } = await ResearchAiService.analyzeReviews(
				workspaceId!,
				body.meta,
				body.reviews,
				{ deep: body.deep, model: body.model },
			);
			return { analysis, model };
		},
		{
			body: analyzeBody,
			detail: {
				description:
					"AI review analysis (categories, sentiment, quick wins, ASO keywords)",
				tags: ["Research"],
			},
		},
	)
	.post(
		"/keywords",
		async ({ body }) => {
			const positions = await ResearchService.keywordPositions(
				body.keywords,
				body.country,
				body.appstoreId,
				body.playstoreId,
			);
			return { positions };
		},
		{
			body: keywordsBody,
			detail: {
				description:
					"Check real search ranking (top 50) of keywords in both stores",
				tags: ["Research"],
			},
		},
	)
	.post(
		"/keyword-scores",
		async ({ body, workspaceId }) => {
			const scores = await ResearchService.keywordScores(
				body.keywords,
				body.country,
				body.appstoreId,
				workspaceId ?? undefined,
			);
			return { scores };
		},
		{
			body: keywordScoresBody,
			detail: {
				description:
					"Score keywords for ASO: popularity, difficulty (with breakdown and ranking tiers), opportunity, classification and download estimates. Results are stored as today's history snapshots.",
				tags: ["Research"],
			},
		},
	)
	.get(
		"/keyword-scores/history",
		async ({ query, workspaceId }) => {
			const entries = await KeywordScoresHistoryService.list(workspaceId!, {
				country: query.country,
				keyword: query.keyword,
			});
			return { entries };
		},
		{
			detail: {
				description:
					"Latest stored keyword score per keyword+country (from daily snapshots)",
				tags: ["Research"],
			},
			query: keywordHistoryQuery,
		},
	)
	.get(
		"/keyword-scores/history/:snapshotId",
		async ({ params, workspaceId }) => {
			const snapshot = await KeywordScoresHistoryService.get(
				workspaceId!,
				params.snapshotId,
			);
			return { snapshot };
		},
		{
			detail: {
				description:
					"One stored keyword score snapshot with its full payload (breakdown, tiers, competitors)",
				tags: ["Research"],
			},
			params: snapshotIdParams,
		},
	)
	.delete(
		"/keyword-scores/history/:snapshotId",
		async ({ params, workspaceId }) => {
			return KeywordScoresHistoryService.delete(
				workspaceId!,
				params.snapshotId,
			);
		},
		{
			detail: {
				description: "Delete a stored keyword score snapshot",
				tags: ["Research"],
			},
			params: snapshotIdParams,
		},
	)
	.get(
		"/keyword-scores/summary",
		async ({ workspaceId }) => {
			const countries = await KeywordScoresHistoryService.summary(workspaceId!);
			return { countries };
		},
		{
			detail: {
				description:
					"Per-country ASO posture aggregates from the latest snapshots: download intervals at current ranks, classification distribution, top opportunities",
				tags: ["Research"],
			},
		},
	)
	.get(
		"/keyword-scores/trend",
		async ({ query, workspaceId }) => {
			const points = await KeywordScoresHistoryService.trend(
				workspaceId!,
				query.keyword,
				query.country,
				query.days,
			);
			return { points };
		},
		{
			detail: {
				description:
					"Daily popularity/difficulty/opportunity/rank trend for one keyword+country",
				tags: ["Research"],
			},
			query: keywordTrendQuery,
		},
	)
	.post(
		"/markets",
		async ({ body }) => {
			const snapshots = await ResearchService.markets(
				body.store,
				body.id,
				body.markets,
			);
			return { snapshots };
		},
		{
			body: marketsBody,
			detail: {
				description:
					"Compare app rating and review stats across country markets",
				tags: ["Research"],
			},
		},
	)
	.post(
		"/visual",
		async ({ body, workspaceId }) => {
			const { model, visual } = await ResearchAiService.analyzeVisual(
				workspaceId!,
				body.meta,
				{ model: body.model },
			);
			return { model, visual };
		},
		{
			body: visualBody,
			detail: {
				description:
					"AI vision analysis of icon + screenshots for store page conversion",
				tags: ["Research"],
			},
		},
	)
	.post(
		"/competitors",
		async ({ body }) => {
			const competitors = await ResearchService.competitors(
				body.store,
				body.id,
				body.title,
				body.country,
				body.genre,
				body.developer,
			);
			return { competitors };
		},
		{
			body: competitorsBody,
			detail: {
				description:
					"Find competitor apps (Play similar / App Store search-based)",
				tags: ["Research"],
			},
		},
	)
	.post(
		"/compare",
		async ({ body, workspaceId }) => {
			const target = ResearchService.resolveTarget({
				country: body.country,
				id: body.competitor.id,
				store: body.competitor.store,
			});
			const { heuristics, meta, reviews } =
				await ResearchService.scrape(target);
			if (!body.ourReviews.length) {
				return {
					compHeuristics: heuristics,
					compMeta: meta,
					compReviews: reviews,
				};
			}
			const { comparison, model } =
				await ResearchAiService.compareWithCompetitor(
					workspaceId!,
					body.ourMeta,
					body.ourReviews,
					meta,
					reviews,
					{ model: body.model },
				);
			return {
				comparison,
				compHeuristics: heuristics,
				compMeta: meta,
				compReviews: reviews,
				model,
			};
		},
		{
			body: compareBody,
			detail: {
				description:
					"Scrape a competitor and (optionally) build an AI diff report vs our app",
				tags: ["Research"],
			},
		},
	)
	.post(
		"/runs",
		async ({ body, workspaceId }) => {
			if (body.appId) {
				await verifyAppOwnership(body.appId, workspaceId!);
			}
			const run = await ResearchRunsService.saveRun(workspaceId!, {
				appId: body.appId ?? null,
				country: body.country,
				report: body.report as unknown as ResearchRunReport,
				summary: body.summary,
				title: body.title,
			});
			return { run };
		},
		{
			body: saveRunBody,
			detail: {
				description: "Save a research report to history",
				tags: ["Research"],
			},
		},
	)
	.get(
		"/runs",
		async ({ workspaceId }) => {
			const runs = await ResearchRunsService.listStandaloneRuns(workspaceId!);
			return { runs };
		},
		{
			detail: {
				description: "List saved standalone research runs (newest first)",
				tags: ["Research"],
			},
		},
	)
	.get(
		"/runs/:runId",
		async ({ params, workspaceId }) => {
			const run = await ResearchRunsService.getRun(workspaceId!, params.runId);
			return { run };
		},
		{
			detail: {
				description: "Get a saved research run with its full report",
				tags: ["Research"],
			},
			params: runIdParams,
		},
	)
	.delete(
		"/runs/:runId",
		async ({ params, workspaceId }) => {
			return ResearchRunsService.deleteRun(workspaceId!, params.runId);
		},
		{
			detail: {
				description: "Delete a saved research run",
				tags: ["Research"],
			},
			params: runIdParams,
		},
	);

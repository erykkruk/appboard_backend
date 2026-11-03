import Elysia from "elysia";
import { authGuard } from "@/modules/auth";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { ResearchRunsService } from "@/modules/research/research.runs.service";
import { TrackingBoardService } from "./board.service";
import { TrackingMarketsService } from "./markets.service";
import { RankCheckJobs } from "./rank-check.jobs";
import {
	addKeywordsBody,
	appIdParams,
	boardQuery,
	bulkAddKeywordsBody,
	checkRunParams,
	configPatchBody,
	historyQuery,
	keywordParams,
	runForAppBody,
	runParams,
} from "./tracking.schema";
import { TrackingService } from "./tracking.service";

export const trackingController = new Elysia({ prefix: "/apps" })
	.use(authGuard)
	// ── Rank tracking ────────────────────────────────────────────────
	.get(
		"/:appId/tracking",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const [config, keywords, positions] = await Promise.all([
				TrackingService.getConfig(params.appId, workspaceId!),
				TrackingService.getKeywords(params.appId),
				TrackingService.getLatestPositions(params.appId),
			]);
			return { config, keywords, positions };
		},
		{
			detail: {
				description:
					"Rank-tracking config, tracked keywords and latest positions",
				tags: ["Tracking"],
			},
			params: appIdParams,
		},
	)
	.get(
		"/:appId/tracking/summary",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return TrackingService.getSummary(params.appId, workspaceId!);
		},
		{
			detail: {
				description:
					"Dashboard rank summary: auto-imports ASO-profile keywords, runs a first check when needed, returns aggregate stats + latest positions",
				tags: ["Tracking"],
			},
			params: appIdParams,
		},
	)
	.patch(
		"/:appId/tracking/config",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const config = await TrackingService.updateConfig(
				params.appId,
				workspaceId!,
				body,
			);
			return { config };
		},
		{
			body: configPatchBody,
			detail: {
				description: "Update rank-tracking / auto-research automation settings",
				tags: ["Tracking"],
			},
			params: appIdParams,
		},
	)
	.post(
		"/:appId/tracking/keywords",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const keywords = await TrackingService.addKeywords(
				params.appId,
				body.country,
				body.keywords,
			);
			return { keywords };
		},
		{
			body: addKeywordsBody,
			detail: {
				description: "Add tracked keywords for a country (max 40 per language)",
				tags: ["Tracking"],
			},
			params: appIdParams,
		},
	)
	.post(
		"/:appId/tracking/keywords/bulk",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return TrackingService.addKeywordsBulk(params.appId, body.items);
		},
		{
			body: bulkAddKeywordsBody,
			detail: {
				description:
					"Add tracked keywords for many markets in one call: { items: [{ country, keywords[] }] }. Never fails the whole request on the per-market cap (20): each market reports added, skipped (already tracked) and rejected (over the cap).",
				tags: ["Tracking"],
			},
			params: appIdParams,
		},
	)
	.delete(
		"/:appId/tracking/keywords/:keywordId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return TrackingService.removeKeyword(params.appId, params.keywordId);
		},
		{
			detail: {
				description: "Remove a tracked keyword",
				tags: ["Tracking"],
			},
			params: keywordParams,
		},
	)
	.post(
		"/:appId/tracking/check",
		async ({ params, set, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const started = await RankCheckJobs.start(
				params.appId,
				workspaceId!,
				"manual",
			);
			set.status = 202;
			return started;
		},
		{
			detail: {
				description:
					"Start measuring current positions for all tracked keywords in the background (202). Lookups are throttled per store, so poll GET /tracking/check/:runId (or GET /tracking/check for the latest run). Returns the running job with alreadyRunning: true when one is in progress. 422 RANK_TRACKING_UNSUPPORTED for tvOS-only apps.",
				tags: ["Tracking"],
			},
			params: appIdParams,
		},
	)
	.get(
		"/:appId/tracking/check",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const run = await RankCheckJobs.latest(params.appId, workspaceId!);
			return { run };
		},
		{
			detail: {
				description: "Latest rank check run (status, progress, failures)",
				tags: ["Tracking"],
			},
			params: appIdParams,
		},
	)
	.get(
		"/:appId/tracking/check/:runId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const run = await RankCheckJobs.get(
				params.appId,
				workspaceId!,
				params.runId,
			);
			return { run };
		},
		{
			detail: {
				description: "One rank check run (status, progress, failures)",
				tags: ["Tracking"],
			},
			params: checkRunParams,
		},
	)
	.get(
		"/:appId/tracking/markets",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return TrackingMarketsService.getMarkets(params.appId, workspaceId!);
		},
		{
			detail: {
				description:
					"Every market of the app at a glance: per country tracked / measured / ranked keywords, top 10 and top 50 counts, median, average and best position, improved / declined / entered / dropped since each keyword's previous measurement, failed lookups in the last run and last check time; plus totals, the latest run and whether the store can be rank-tracked at all (tvOS-only apps cannot). Drill down with GET /tracking/board?country=.",
				tags: ["Tracking"],
			},
			params: appIdParams,
		},
	)
	.get(
		"/:appId/tracking/board",
		async ({ params, query, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return TrackingBoardService.getBoard(params.appId, workspaceId!, {
				country: query.country,
			});
		},
		{
			detail: {
				description:
					"Everything the tracker view shows for one market in a single call: per keyword the position, its score and trend, the leader of the phrase and which listing fields already carry it; plus what moved since the previous run, the runs themselves, our listing changes and the terms our metadata targets without ranking.",
				tags: ["Tracking"],
			},
			params: appIdParams,
			query: boardQuery,
		},
	)
	.get(
		"/:appId/tracking/history",
		async ({ params, query, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return TrackingService.getHistory(params.appId, {
				country: query.country,
				keyword: query.keyword,
			});
		},
		{
			detail: {
				description:
					"Rank-position time series + listing-change annotations for the chart",
				tags: ["Tracking"],
			},
			params: appIdParams,
			query: historyQuery,
		},
	)
	// ── Per-app research history ─────────────────────────────────────
	.get(
		"/:appId/research-runs",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const runs = await ResearchRunsService.listRuns(workspaceId!, {
				appId: params.appId,
			});
			return { runs };
		},
		{
			detail: {
				description: "List saved research runs for this app",
				tags: ["Tracking"],
			},
			params: appIdParams,
		},
	)
	.post(
		"/:appId/research-runs/run",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const run = await ResearchRunsService.runForApp(
				params.appId,
				workspaceId!,
				{ country: body.country, deep: body.deep, keywords: body.keywords },
			);
			return { run };
		},
		{
			body: runForAppBody,
			detail: {
				description:
					"Run research on this connected app and save it to history",
				tags: ["Tracking"],
			},
			params: appIdParams,
		},
	)
	.get(
		"/:appId/research-runs/:runId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const run = await ResearchRunsService.getRun(
				workspaceId!,
				params.runId,
				params.appId,
			);
			return { run };
		},
		{
			detail: {
				description: "Get a saved research run for this app",
				tags: ["Tracking"],
			},
			params: runParams,
		},
	)
	.delete(
		"/:appId/research-runs/:runId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return ResearchRunsService.deleteRun(
				workspaceId!,
				params.runId,
				params.appId,
			);
		},
		{
			detail: {
				description: "Delete a saved research run",
				tags: ["Tracking"],
			},
			params: runParams,
		},
	);

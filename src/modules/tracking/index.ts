import Elysia from "elysia";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { ResearchRunsService } from "@/modules/research/research.runs.service";
import {
	addKeywordsBody,
	appIdParams,
	configPatchBody,
	historyQuery,
	keywordParams,
	runForAppBody,
	runParams,
} from "./tracking.schema";
import { TrackingService } from "./tracking.service";

export const trackingController = new Elysia({ prefix: "/apps" })
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
				description: "Add tracked keywords for a country (max 20 per language)",
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
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const result = await TrackingService.runRankCheck(
				params.appId,
				workspaceId!,
				"manual",
			);
			return { result };
		},
		{
			detail: {
				description: "Measure current positions for all tracked keywords now",
				tags: ["Tracking"],
			},
			params: appIdParams,
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

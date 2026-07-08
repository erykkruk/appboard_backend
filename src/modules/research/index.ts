import Elysia from "elysia";
import { ResearchAiService } from "./research.ai";
import {
	analyzeBody,
	compareBody,
	competitorsBody,
	keywordsBody,
	marketsBody,
	scrapeBody,
	searchBody,
	visualBody,
} from "./research.schema";
import { ResearchService } from "./research.service";

export const researchController = new Elysia({ prefix: "/research" })
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
	);

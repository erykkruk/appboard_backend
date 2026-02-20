import Elysia from "elysia";
import {
	replyBody,
	reviewIdParams,
	reviewsParams,
	reviewsQuery,
} from "./reviews.schema";
import { ReviewsService } from "./reviews.service";

export const reviewsController = new Elysia({ prefix: "/apps" })
	.get(
		"/:appId/reviews",
		async ({ params, query }) => {
			const result = await ReviewsService.list(params.appId, {
				hasReply: query.hasReply,
				language: query.language,
				rating: query.rating,
				storeType: query.storeType,
			});
			return { reviews: result };
		},
		{
			detail: {
				description: "List reviews for an app",
				tags: ["Reviews"],
			},
			params: reviewsParams,
			query: reviewsQuery,
		},
	)
	.get(
		"/:appId/reviews/stats",
		async ({ params }) => {
			return ReviewsService.getStats(params.appId);
		},
		{
			detail: {
				description: "Get review statistics",
				tags: ["Reviews"],
			},
			params: reviewsParams,
		},
	)
	.post(
		"/:appId/reviews/:reviewId/reply",
		async ({ body, params }) => {
			return ReviewsService.reply(params.appId, params.reviewId, body.text);
		},
		{
			body: replyBody,
			detail: {
				description: "Reply to a review",
				tags: ["Reviews"],
			},
			params: reviewIdParams,
		},
	)
	.post(
		"/:appId/reviews/sync",
		async ({ params }) => {
			return ReviewsService.syncFromStore(params.appId);
		},
		{
			detail: {
				description: "Sync reviews from store",
				tags: ["Reviews"],
			},
			params: reviewsParams,
		},
	);

import Elysia from "elysia";
import { authGuard } from "@/modules/auth";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { describeStoreError } from "@/modules/tracking/rank-lookup";
import { RatingsService } from "./ratings.service";
import {
	replyBody,
	reviewIdParams,
	reviewsParams,
	reviewsQuery,
	scopeOnlyQuery,
} from "./reviews.schema";
import { ReviewsService, resolveReviewScope } from "./reviews.service";

export const reviewsController = new Elysia({ prefix: "/apps" })
	.use(authGuard)
	.get(
		"/:appId/reviews",
		async ({ params, query, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const { appIds } = await resolveReviewScope(
				params.appId,
				workspaceId!,
				query.scope,
			);
			const [result, countries] = await Promise.all([
				ReviewsService.list(appIds, {
					country: query.country,
					hasReply: query.hasReply,
					language: query.language,
					rating: query.rating,
					storeType: query.storeType,
				}),
				ReviewsService.countries(appIds),
			]);
			return { countries, reviews: result };
		},
		{
			detail: {
				description:
					"List reviews for an app, or for its whole app group with scope=group",
				tags: ["Reviews"],
			},
			params: reviewsParams,
			query: reviewsQuery,
		},
	)
	.get(
		"/:appId/reviews/stats",
		async ({ params, query, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const { appIds } = await resolveReviewScope(
				params.appId,
				workspaceId!,
				query.scope,
			);
			return ReviewsService.getStats(appIds);
		},
		{
			detail: {
				description: "Get review statistics",
				tags: ["Reviews"],
			},
			params: reviewsParams,
			query: scopeOnlyQuery,
		},
	)
	.get(
		"/:appId/reviews/ratings",
		async ({ params, query, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return RatingsService.getSummary(
				params.appId,
				workspaceId!,
				query.scope ?? "app",
			);
		},
		{
			detail: {
				description:
					"Store ratings (star-only included) per store and country, with totals. scope=group sums the app group",
				tags: ["Reviews"],
			},
			params: reviewsParams,
			query: scopeOnlyQuery,
		},
	)
	.post(
		"/:appId/reviews/ratings/refresh",
		async ({ params, query, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return RatingsService.startRefresh(
				params.appId,
				workspaceId!,
				query.scope ?? "app",
			);
		},
		{
			detail: {
				description:
					"Refresh store ratings now, in the background (paced like the daily refresh)",
				tags: ["Reviews"],
			},
			params: reviewsParams,
			query: scopeOnlyQuery,
		},
	)
	.post(
		"/:appId/reviews/:reviewId/reply",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
		async ({ params, query, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const { appIds } = await resolveReviewScope(
				params.appId,
				workspaceId!,
				query.scope,
			);
			if (appIds.length === 1) {
				return ReviewsService.syncFromStore(appIds[0]);
			}
			// One failing store (an expired key) must not hide the other's reviews.
			let synced = 0;
			const errors: { appId: string; message: string }[] = [];
			for (const id of appIds) {
				try {
					synced += (await ReviewsService.syncFromStore(id)).synced;
				} catch (err) {
					errors.push({
						appId: id,
						message: describeStoreError(err).message,
					});
				}
			}
			return { errors, synced };
		},
		{
			detail: {
				description:
					"Sync reviews from store (scope=group syncs every app of the group)",
				tags: ["Reviews"],
			},
			params: reviewsParams,
			query: scopeOnlyQuery,
		},
	);

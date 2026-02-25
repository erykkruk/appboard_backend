import Elysia from "elysia";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { ageRatingParams, upsertAgeRatingBody } from "./age-rating.schema";
import { AgeRatingService } from "./age-rating.service";
import { AGE_RATING_PRESETS } from "./age-rating.templates";

export const ageRatingPresetsController = new Elysia().get(
	"/age-rating-presets",
	() => {
		return { presets: AGE_RATING_PRESETS };
	},
	{
		detail: {
			description: "List all age rating presets",
			tags: ["Age Rating"],
		},
	},
);

export const ageRatingController = new Elysia({
	prefix: "/apps/:appId/age-rating",
})
	.get(
		"/",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const rating = await AgeRatingService.get(params.appId);
			return { ageRating: rating };
		},
		{
			detail: {
				description: "Get age rating for an app",
				tags: ["Age Rating"],
			},
			params: ageRatingParams,
		},
	)
	.put(
		"/",
		async ({ params, body, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const rating = await AgeRatingService.upsert(params.appId, body);
			return { ageRating: rating };
		},
		{
			body: upsertAgeRatingBody,
			detail: {
				description: "Auto-save age rating to local DB",
				tags: ["Age Rating"],
			},
			params: ageRatingParams,
		},
	)
	.post(
		"/publish",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return AgeRatingService.publish(params.appId);
		},
		{
			detail: {
				description: "Publish age rating to store",
				tags: ["Age Rating"],
			},
			params: ageRatingParams,
		},
	);

import Elysia from "elysia";
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
		async ({ params }) => {
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
		async ({ params, body }) => {
			const rating = await AgeRatingService.upsert(params.appId, body);
			return { ageRating: rating };
		},
		{
			body: upsertAgeRatingBody,
			detail: {
				description: "Create or update age rating",
				tags: ["Age Rating"],
			},
			params: ageRatingParams,
		},
	);

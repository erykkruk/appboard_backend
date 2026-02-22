import Elysia from "elysia";
import { asoProfileParams, upsertAsoProfileBody } from "./aso-profile.schema";
import { AsoProfileService } from "./aso-profile.service";

export const asoProfileController = new Elysia({
	prefix: "/apps/:appId/aso-profile",
})
	.get(
		"/",
		async ({ params }) => {
			const profile = await AsoProfileService.get(params.appId);
			return { asoProfile: profile };
		},
		{
			detail: {
				description: "Get ASO profile for an app",
				tags: ["ASO Profile"],
			},
			params: asoProfileParams,
		},
	)
	.put(
		"/",
		async ({ params, body }) => {
			const profile = await AsoProfileService.upsert(params.appId, body);
			return { asoProfile: profile };
		},
		{
			body: upsertAsoProfileBody,
			detail: {
				description: "Create or update ASO profile",
				tags: ["ASO Profile"],
			},
			params: asoProfileParams,
		},
	);

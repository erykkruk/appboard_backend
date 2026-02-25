import Elysia from "elysia";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { asoProfileParams, upsertAsoProfileBody } from "./aso-profile.schema";
import { AsoProfileService } from "./aso-profile.service";

export const asoProfileController = new Elysia({
	prefix: "/apps/:appId/aso-profile",
})
	.get(
		"/",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
		async ({ params, body, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const profile = await AsoProfileService.upsert(params.appId, body);
			return { asoProfile: profile };
		},
		{
			body: upsertAsoProfileBody,
			detail: {
				description: "Auto-save ASO profile to local DB",
				tags: ["ASO Profile"],
			},
			params: asoProfileParams,
		},
	);

import Elysia from "elysia";
import { AppGroupsService } from "@/modules/app-groups/app-groups.service";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { buildError } from "@/utils/errors";
import {
	asoProfileParams,
	copyFromBody,
	upsertAsoProfileBody,
} from "./aso-profile.schema";
import { AsoProfileService } from "./aso-profile.service";

export const asoProfileController = new Elysia({
	prefix: "/apps/:appId/aso-profile",
})
	.get(
		"/",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const profile = await AsoProfileService.get(params.appId);

			const groupInfo = await AppGroupsService.getGroupForApp(params.appId);
			if (groupInfo?.useSharedProfile) {
				return {
					asoProfile: profile,
					groupId: groupInfo.groupId,
					locked: true,
				};
			}

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

			const groupInfo = await AppGroupsService.getGroupForApp(params.appId);
			if (groupInfo?.useSharedProfile) {
				throw buildError("forbidden", {
					info: "ASO profile is managed at group level",
				});
			}

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
	)
	.post(
		"/copy-from",
		async ({ params, body, workspaceId }) => {
			if (params.appId === body.sourceAppId) {
				throw buildError("badRequest", {
					info: "Cannot copy profile to the same app",
				});
			}

			await verifyAppOwnership(params.appId, workspaceId!);
			await verifyAppOwnership(body.sourceAppId, workspaceId!);

			const sourceProfile = await AsoProfileService.get(body.sourceAppId);
			if (!sourceProfile) {
				buildError("notFound", {
					info: "Source app ASO profile not found",
				});
			}

			const {
				id: _id,
				appId: _appId,
				createdAt: _createdAt,
				updatedAt: _updatedAt,
				...profileData
			} = sourceProfile;

			const result = await AsoProfileService.upsert(params.appId, profileData);
			return { asoProfile: result };
		},
		{
			body: copyFromBody,
			detail: {
				description: "Copy ASO profile from another app in the workspace",
				tags: ["ASO Profile"],
			},
			params: asoProfileParams,
		},
	);

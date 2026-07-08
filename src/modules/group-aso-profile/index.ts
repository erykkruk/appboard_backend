import { eq } from "drizzle-orm";
import Elysia from "elysia";
import { AppGroupsService } from "@/modules/app-groups/app-groups.service";
import { AsoProfileService } from "@/modules/aso-profile/aso-profile.service";
import { db } from "@/utils/db";
import { appGroupMembers, appGroups } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import {
	enableSharedProfileBody,
	groupAsoProfileParams,
	upsertGroupAsoProfileBody,
} from "./group-aso-profile.schema";
import { GroupAsoProfileService } from "./group-aso-profile.service";

export const groupAsoProfileController = new Elysia({
	prefix: "/app-groups/:groupId/aso-profile",
})
	.get(
		"/",
		async ({ params, workspaceId }) => {
			await AppGroupsService.verifyGroupOwnership(params.groupId, workspaceId!);

			const [groupRow] = await db
				.select({ useSharedProfile: appGroups.useSharedProfile })
				.from(appGroups)
				.where(eq(appGroups.id, params.groupId))
				.limit(1);

			const profile = await GroupAsoProfileService.get(params.groupId);
			return {
				asoProfile: profile,
				useSharedProfile: groupRow.useSharedProfile,
			};
		},
		{
			detail: {
				description: "Get ASO profile for a group",
				tags: ["Group ASO Profile"],
			},
			params: groupAsoProfileParams,
		},
	)
	.put(
		"/",
		async ({ params, body, workspaceId }) => {
			await AppGroupsService.verifyGroupOwnership(params.groupId, workspaceId!);

			const [groupRow] = await db
				.select({ useSharedProfile: appGroups.useSharedProfile })
				.from(appGroups)
				.where(eq(appGroups.id, params.groupId))
				.limit(1);

			if (!groupRow.useSharedProfile) {
				throw buildError("badRequest", {
					info: "Shared ASO profile is not enabled for this group",
				});
			}

			const profile = await GroupAsoProfileService.upsert(params.groupId, body);
			return { asoProfile: profile };
		},
		{
			body: upsertGroupAsoProfileBody,
			detail: {
				description: "Upsert ASO profile for a group",
				tags: ["Group ASO Profile"],
			},
			params: groupAsoProfileParams,
		},
	)
	.post(
		"/enable",
		async ({ params, body, workspaceId }) => {
			await AppGroupsService.verifyGroupOwnership(params.groupId, workspaceId!);

			// If sourceAppId provided, verify it belongs to this group
			if (body.sourceAppId) {
				const members = await db
					.select({ appId: appGroupMembers.appId })
					.from(appGroupMembers)
					.where(eq(appGroupMembers.groupId, params.groupId));

				const memberAppIds = new Set(members.map((m) => m.appId));

				if (!memberAppIds.has(body.sourceAppId)) {
					throw buildError("badRequest", {
						info: "Source app is not a member of this group",
					});
				}

				// Copy ASO profile from source app to group
				const sourceProfile = await AsoProfileService.get(body.sourceAppId);
				if (sourceProfile) {
					const {
						id: _id,
						appId: _appId,
						createdAt: _createdAt,
						updatedAt: _updatedAt,
						...profileData
					} = sourceProfile;
					await GroupAsoProfileService.upsert(params.groupId, profileData);
				}
			}

			// Enable shared profile
			await db
				.update(appGroups)
				.set({ useSharedProfile: true })
				.where(eq(appGroups.id, params.groupId));

			const profile = await GroupAsoProfileService.get(params.groupId);
			return { asoProfile: profile, useSharedProfile: true };
		},
		{
			body: enableSharedProfileBody,
			detail: {
				description:
					"Enable shared ASO profile, optionally copying from a member app",
				tags: ["Group ASO Profile"],
			},
			params: groupAsoProfileParams,
		},
	);

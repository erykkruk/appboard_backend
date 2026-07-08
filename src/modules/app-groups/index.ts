import Elysia from "elysia";
import {
	addMemberBody,
	createGroupBody,
	generateListingsBody,
	groupIdParams,
	memberParams,
	reorderGroupsBody,
	reorderMembersBody,
	updateGroupBody,
} from "./app-groups.schema";
import { AppGroupsService } from "./app-groups.service";
import { GroupGenerationService } from "./group-generation.service";

export const appGroupsController = new Elysia({ prefix: "/app-groups" })
	.get(
		"/",
		async ({ workspaceId }) => {
			const groups = await AppGroupsService.list(workspaceId!);
			return { appGroups: groups };
		},
		{
			detail: { description: "List all app groups", tags: ["App Groups"] },
		},
	)
	.get(
		"/:groupId",
		async ({ params, workspaceId }) => {
			const group = await AppGroupsService.getById(
				params.groupId,
				workspaceId!,
			);
			return { appGroup: group };
		},
		{
			detail: { description: "Get app group details", tags: ["App Groups"] },
			params: groupIdParams,
		},
	)
	.post(
		"/",
		async ({ body, workspaceId }) => {
			const group = await AppGroupsService.create(workspaceId!, body);
			return { appGroup: group };
		},
		{
			body: createGroupBody,
			detail: { description: "Create an app group", tags: ["App Groups"] },
		},
	)
	.put(
		"/:groupId",
		async ({ body, params, workspaceId }) => {
			const group = await AppGroupsService.update(
				params.groupId,
				workspaceId!,
				body,
			);
			return { appGroup: group };
		},
		{
			body: updateGroupBody,
			detail: { description: "Update an app group", tags: ["App Groups"] },
			params: groupIdParams,
		},
	)
	.delete(
		"/:groupId",
		async ({ params, workspaceId }) => {
			return AppGroupsService.remove(params.groupId, workspaceId!);
		},
		{
			detail: { description: "Delete an app group", tags: ["App Groups"] },
			params: groupIdParams,
		},
	)
	.post(
		"/:groupId/members",
		async ({ body, params, workspaceId }) => {
			const member = await AppGroupsService.addMember(
				params.groupId,
				body.appId,
				workspaceId!,
			);
			return { member };
		},
		{
			body: addMemberBody,
			detail: {
				description: "Add an app to a group",
				tags: ["App Groups"],
			},
			params: groupIdParams,
		},
	)
	.delete(
		"/:groupId/members/:appId",
		async ({ params, workspaceId }) => {
			return AppGroupsService.removeMember(
				params.groupId,
				params.appId,
				workspaceId!,
			);
		},
		{
			detail: {
				description: "Remove an app from a group",
				tags: ["App Groups"],
			},
			params: memberParams,
		},
	)
	.put(
		"/reorder",
		async ({ body, workspaceId }) => {
			return AppGroupsService.reorderGroups(workspaceId!, body.groupIds);
		},
		{
			body: reorderGroupsBody,
			detail: {
				description: "Reorder app groups",
				tags: ["App Groups"],
			},
		},
	)
	.put(
		"/:groupId/reorder",
		async ({ body, params, workspaceId }) => {
			return AppGroupsService.reorderMembers(
				params.groupId,
				workspaceId!,
				body.appIds,
			);
		},
		{
			body: reorderMembersBody,
			detail: {
				description: "Reorder apps within a group",
				tags: ["App Groups"],
			},
			params: groupIdParams,
		},
	)
	.post(
		"/:groupId/generate-listings",
		async ({ body, params, workspaceId }) => {
			return GroupGenerationService.generateListings(
				workspaceId!,
				params.groupId,
				{
					fields: body.fields,
					sourceLanguage: body.sourceLanguage,
					translateToOthers: body.translateToOthers,
				},
			);
		},
		{
			body: generateListingsBody,
			detail: {
				description:
					"AI-generate listing drafts for every app in the group (Android + iOS) from the shared ASO profile",
				tags: ["App Groups"],
			},
			params: groupIdParams,
		},
	);

import Elysia from "elysia";
import { getCapabilities } from "@/config/capabilities";
import type { Platform } from "@/config/const";
import { appIdParams, appsQuery } from "./apps.schema";
import { AppsService } from "./apps.service";

export const appsController = new Elysia({ prefix: "/apps" })
	.get(
		"/",
		async ({ query, workspaceId }) => {
			const appsList = await AppsService.findAll(workspaceId!, {
				platform: query.platform as Platform | undefined,
				storeId: query.storeId,
			});
			return { apps: appsList };
		},
		{
			detail: { description: "List all apps", tags: ["Apps"] },
			query: appsQuery,
		},
	)
	.get(
		"/:appId",
		async ({ params, workspaceId }) => {
			const app = await AppsService.findOne(workspaceId!, params.appId);
			return { app };
		},
		{
			detail: { description: "Get app details", tags: ["Apps"] },
			params: appIdParams,
		},
	)
	.get(
		"/:appId/capabilities",
		async ({ params, workspaceId }) => {
			const app = await AppsService.findOne(workspaceId!, params.appId);
			return { capabilities: getCapabilities(app.platform) };
		},
		{
			detail: {
				description: "Get platform capabilities for an app",
				tags: ["Apps"],
			},
			params: appIdParams,
		},
	);

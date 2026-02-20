import Elysia from "elysia";
import type { Platform } from "@/config/const";
import { appIdParams, appsQuery } from "./apps.schema";
import { AppsService } from "./apps.service";

export const appsController = new Elysia({ prefix: "/apps" })
	.get(
		"/",
		async ({ query }) => {
			const appsList = await AppsService.findAll({
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
		async ({ params }) => {
			const app = await AppsService.findOne(params.appId);
			return { app };
		},
		{
			detail: { description: "Get app details", tags: ["Apps"] },
			params: appIdParams,
		},
	);

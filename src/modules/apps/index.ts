import Elysia, { t } from "elysia";
import { getCapabilities } from "@/config/capabilities";
import type { Platform } from "@/config/const";
import { authGuard } from "@/modules/auth";
import { appIdParams, appsQuery } from "./apps.schema";
import { AppsService } from "./apps.service";

export const appsController = new Elysia({ prefix: "/apps" })
	.use(authGuard)
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
	.post(
		"/",
		async ({ body, workspaceId }) => {
			const app = await AppsService.createLocal(workspaceId!, {
				bundleId: body.bundleId,
				name: body.name,
				platform: body.platform as Platform,
			});
			return { app };
		},
		{
			body: t.Object({
				bundleId: t.Optional(t.String({ maxLength: 255 })),
				name: t.String({ maxLength: 255, minLength: 1 }),
				platform: t.Union([t.Literal("ios"), t.Literal("android")]),
			}),
			detail: {
				description:
					"Create an app that is not published in any store yet. Nothing is fetched and nothing is audited - you write the listing here, and connect a store later.",
				tags: ["Apps"],
			},
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
			// `connectionMode` rides along so the panel can tell an API-backed app
			// from a link-imported one without a second request to /stores.
			return {
				capabilities: getCapabilities(app.platform),
				connectionMode: app.store.connectionMode,
			};
		},
		{
			detail: {
				description: "Get platform capabilities and connection mode for an app",
				tags: ["Apps"],
			},
			params: appIdParams,
		},
	);

import Elysia, { t } from "elysia";
import { PublishingService } from "./publishing.service";

const appIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

export const publishingController = new Elysia({ prefix: "/apps" })
	.get(
		"/:appId/publishing/overview",
		async ({ params }) => {
			return PublishingService.getOverview(params.appId);
		},
		{
			detail: {
				description: "Get publishing overview with pending changes",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.post(
		"/:appId/publishing/publish",
		async ({ body, params }) => {
			return PublishingService.publishAll(params.appId, {
				submitForReview: body?.submitForReview,
			});
		},
		{
			body: t.Optional(
				t.Object({
					submitForReview: t.Optional(t.Boolean()),
				}),
			),
			detail: {
				description: "Publish all pending changes to the store",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.get(
		"/:appId/publishing/versions",
		async ({ params }) => {
			return PublishingService.listVersions(params.appId);
		},
		{
			detail: {
				description: "List all App Store versions",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.get(
		"/:appId/publishing/version",
		async ({ params }) => {
			const version = await PublishingService.getVersionInfo(params.appId);
			return { version };
		},
		{
			detail: {
				description: "Get current app store version info",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.post(
		"/:appId/publishing/create-version",
		async ({ body, params }) => {
			const result = await PublishingService.createVersion(
				params.appId,
				body.versionString,
			);
			return { version: result };
		},
		{
			body: t.Object({
				versionString: t.String({ minLength: 1 }),
			}),
			detail: {
				description: "Create a new App Store version",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.post(
		"/:appId/publishing/submit-review",
		async ({ params }) => {
			return PublishingService.submitForReview(params.appId);
		},
		{
			detail: {
				description: "Submit the app for Apple review",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	);

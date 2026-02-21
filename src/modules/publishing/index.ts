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
		"/:appId/publishing/versions/:versionId",
		async ({ params }) => {
			return PublishingService.getVersionLocalizations(
				params.appId,
				params.versionId,
			);
		},
		{
			detail: {
				description: "Get localizations for a specific App Store version",
				tags: ["Publishing"],
			},
			params: t.Object({
				appId: t.String({ format: "uuid" }),
				versionId: t.String({ minLength: 1 }),
			}),
		},
	)
	.post(
		"/:appId/publishing/versions/:versionId/localizations",
		async ({ body, params }) => {
			return PublishingService.addVersionLocalization(
				params.appId,
				params.versionId,
				body.locale,
			);
		},
		{
			body: t.Object({
				locale: t.String({ minLength: 1 }),
			}),
			detail: {
				description: "Add a localization to an App Store version",
				tags: ["Publishing"],
			},
			params: t.Object({
				appId: t.String({ format: "uuid" }),
				versionId: t.String({ minLength: 1 }),
			}),
		},
	)
	.delete(
		"/:appId/publishing/versions/:versionId/localizations/:localizationId",
		async ({ params }) => {
			return PublishingService.deleteVersionLocalization(
				params.appId,
				params.localizationId,
			);
		},
		{
			detail: {
				description: "Delete a localization from an App Store version",
				tags: ["Publishing"],
			},
			params: t.Object({
				appId: t.String({ format: "uuid" }),
				localizationId: t.String({ minLength: 1 }),
				versionId: t.String({ minLength: 1 }),
			}),
		},
	)
	.get(
		"/:appId/publishing/versions/:versionId/screenshots",
		async ({ params }) => {
			return PublishingService.getVersionScreenshots(
				params.appId,
				params.versionId,
			);
		},
		{
			detail: {
				description: "Get iPhone screenshots for a specific App Store version",
				tags: ["Publishing"],
			},
			params: t.Object({
				appId: t.String({ format: "uuid" }),
				versionId: t.String({ minLength: 1 }),
			}),
		},
	)
	.post(
		"/:appId/publishing/screenshots/preview",
		async ({ body }) => {
			const cropParams =
				body.cropX !== undefined &&
				body.cropY !== undefined &&
				body.cropWidth !== undefined &&
				body.cropHeight !== undefined
					? {
							height: body.cropHeight,
							width: body.cropWidth,
							x: body.cropX,
							y: body.cropY,
						}
					: undefined;
			return PublishingService.previewScreenshot(
				body.displayType,
				body.file,
				cropParams,
			);
		},
		{
			body: t.Object({
				cropHeight: t.Optional(t.Numeric()),
				cropWidth: t.Optional(t.Numeric()),
				cropX: t.Optional(t.Numeric()),
				cropY: t.Optional(t.Numeric()),
				displayType: t.String({ minLength: 1 }),
				file: t.File(),
			}),
			detail: {
				description:
					"Preview a processed screenshot (crop, resize, flatten alpha)",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.post(
		"/:appId/publishing/screenshots/upload",
		async ({ body, params }) => {
			const cropParams =
				body.cropX !== undefined &&
				body.cropY !== undefined &&
				body.cropWidth !== undefined &&
				body.cropHeight !== undefined
					? {
							height: body.cropHeight,
							width: body.cropWidth,
							x: body.cropX,
							y: body.cropY,
						}
					: undefined;
			return PublishingService.uploadScreenshot(
				params.appId,
				body.versionId,
				body.language,
				body.displayType,
				body.file,
				cropParams,
			);
		},
		{
			body: t.Object({
				cropHeight: t.Optional(t.Numeric()),
				cropWidth: t.Optional(t.Numeric()),
				cropX: t.Optional(t.Numeric()),
				cropY: t.Optional(t.Numeric()),
				displayType: t.String({ minLength: 1 }),
				file: t.File(),
				language: t.String({ minLength: 1 }),
				versionId: t.String({ minLength: 1 }),
			}),
			detail: {
				description: "Upload a screenshot to App Store Connect",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.delete(
		"/:appId/publishing/screenshots/:screenshotId",
		async ({ params }) => {
			return PublishingService.deleteScreenshot(
				params.appId,
				params.screenshotId,
			);
		},
		{
			detail: {
				description: "Delete a screenshot from App Store Connect",
				tags: ["Publishing"],
			},
			params: t.Object({
				appId: t.String({ format: "uuid" }),
				screenshotId: t.String({ minLength: 1 }),
			}),
		},
	)
	.patch(
		"/:appId/publishing/screenshots/reorder",
		async ({ body, params }) => {
			return PublishingService.reorderScreenshots(
				params.appId,
				body.screenshotSetId,
				body.screenshotIds,
			);
		},
		{
			body: t.Object({
				screenshotIds: t.Array(t.String({ minLength: 1 })),
				screenshotSetId: t.String({ minLength: 1 }),
			}),
			detail: {
				description: "Reorder screenshots in a screenshot set",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.delete(
		"/:appId/publishing/screenshot-sets/:screenshotSetId",
		async ({ params }) => {
			return PublishingService.deleteAllScreenshots(
				params.appId,
				params.screenshotSetId,
			);
		},
		{
			detail: {
				description: "Delete all screenshots from a screenshot set",
				tags: ["Publishing"],
			},
			params: t.Object({
				appId: t.String({ format: "uuid" }),
				screenshotSetId: t.String({ minLength: 1 }),
			}),
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

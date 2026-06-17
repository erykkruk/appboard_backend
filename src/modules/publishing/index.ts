import Elysia, { t } from "elysia";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { SettingsService } from "@/modules/settings/settings.service";
import { PublishingService } from "./publishing.service";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const PUBLISH_MODE_KEY_PREFIX = "PUBLISH_MODE";
const PUBLISH_SCHEDULED_AT_KEY_PREFIX = "PUBLISH_SCHEDULED_AT";
const DEFAULT_PUBLISH_MODE = "manual";

function publishModeKey(appId: string): string {
	return `${PUBLISH_MODE_KEY_PREFIX}::${appId}`;
}

function publishScheduledAtKey(appId: string): string {
	return `${PUBLISH_SCHEDULED_AT_KEY_PREFIX}::${appId}`;
}

const appIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

const screenshotFile = t.File({ maxSize: MAX_FILE_SIZE });
const optionalCropParam = t.Optional(t.Numeric({ maximum: 20000, minimum: 0 }));

async function withScreenshotCopy<T extends Record<string, unknown>>(
	result: T,
	appId: string,
	versionId: string,
	copyFrom: string | undefined,
	targetLocale: string,
): Promise<T & { screenshotsCopied?: number; screenshotsCopyError?: boolean }> {
	if (!copyFrom) return result;
	try {
		const copyResult = await PublishingService.copyScreenshots(
			appId,
			versionId,
			copyFrom,
			targetLocale,
		);
		return { ...result, screenshotsCopied: copyResult.copied };
	} catch {
		return { ...result, screenshotsCopied: 0, screenshotsCopyError: true };
	}
}

export const publishingController = new Elysia({ prefix: "/apps" })
	.get(
		"/:appId/publishing/overview",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
	.get(
		"/:appId/publishing/push-preview",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PublishingService.getPushPreview(params.appId);
		},
		{
			detail: {
				description:
					"Get preview of all changes that will be pushed to the store",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.get(
		"/:appId/publishing/settings",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const mode = await SettingsService.getRaw(
				workspaceId!,
				publishModeKey(params.appId),
			);
			const scheduledAt = await SettingsService.getRaw(
				workspaceId!,
				publishScheduledAtKey(params.appId),
			);
			return {
				publishMode: mode ?? DEFAULT_PUBLISH_MODE,
				publishScheduledAt: scheduledAt ?? null,
			};
		},
		{
			detail: {
				description: "Get publish mode settings for the app",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.put(
		"/:appId/publishing/settings",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			await SettingsService.set(
				workspaceId!,
				publishModeKey(params.appId),
				body.publishMode,
			);

			if (body.publishMode === "scheduled" && body.publishScheduledAt) {
				await SettingsService.set(
					workspaceId!,
					publishScheduledAtKey(params.appId),
					body.publishScheduledAt,
				);
			} else {
				// Clear scheduled timestamp when not in scheduled mode
				await SettingsService.delete(
					workspaceId!,
					publishScheduledAtKey(params.appId),
				);
			}

			return {
				publishMode: body.publishMode,
				publishScheduledAt:
					body.publishMode === "scheduled"
						? (body.publishScheduledAt ?? null)
						: null,
			};
		},
		{
			body: t.Object({
				publishMode: t.Union([
					t.Literal("manual"),
					t.Literal("auto"),
					t.Literal("scheduled"),
				]),
				publishScheduledAt: t.Optional(t.String({ format: "date-time" })),
			}),
			detail: {
				description: "Update publish mode settings for the app",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.post(
		"/:appId/publishing/publish",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
		"/:appId/publishing/versions/:versionId/localizations/translate",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const result =
				await PublishingService.addVersionLocalizationWithTranslation(
					params.appId,
					params.versionId,
					body.locale,
					body.sourceLocale,
				);

			return withScreenshotCopy(
				result,
				params.appId,
				params.versionId,
				body.copyScreenshotsFrom,
				body.locale,
			);
		},
		{
			body: t.Object({
				copyScreenshotsFrom: t.Optional(t.String({ minLength: 1 })),
				locale: t.String({ minLength: 1 }),
				sourceLocale: t.String({ minLength: 1 }),
			}),
			detail: {
				description:
					"Add a localization with AI translation from a source language",
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
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const result = await PublishingService.addVersionLocalization(
				params.appId,
				params.versionId,
				body.locale,
			);

			return withScreenshotCopy(
				result,
				params.appId,
				params.versionId,
				body.copyScreenshotsFrom,
				body.locale,
			);
		},
		{
			body: t.Object({
				copyScreenshotsFrom: t.Optional(t.String({ minLength: 1 })),
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
	.patch(
		"/:appId/publishing/versions/:versionId/localizations/:localizationId",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PublishingService.updateVersionLocalization(
				params.appId,
				params.versionId,
				params.localizationId,
				body,
			);
		},
		{
			body: t.Object({
				description: t.Optional(t.String()),
				fullDescription: t.Optional(t.String()),
				keywords: t.Optional(t.String()),
				marketingUrl: t.Optional(t.String()),
				promotionalText: t.Optional(t.String()),
				shortDescription: t.Optional(t.String()),
				subtitle: t.Optional(t.String()),
				supportUrl: t.Optional(t.String()),
				title: t.Optional(t.String()),
				whatsNew: t.Optional(t.String()),
			}),
			detail: {
				description: "Update a version localization",
				tags: ["Publishing"],
			},
			params: t.Object({
				appId: t.String({ format: "uuid" }),
				localizationId: t.String({ minLength: 1 }),
				versionId: t.String({ minLength: 1 }),
			}),
		},
	)
	.delete(
		"/:appId/publishing/versions/:versionId/localizations/:localizationId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
		"/:appId/publishing/screenshots/validate",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PublishingService.validateScreenshotFile(
				body.displayType,
				body.file,
			);
		},
		{
			body: t.Object({
				displayType: t.String({ maxLength: 100, minLength: 1 }),
				file: screenshotFile,
			}),
			detail: {
				description:
					"Validate a screenshot's dimensions against the accepted preset(s) for a display type without uploading",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.post(
		"/:appId/publishing/screenshots/preview",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
				cropHeight: optionalCropParam,
				cropWidth: optionalCropParam,
				cropX: optionalCropParam,
				cropY: optionalCropParam,
				displayType: t.String({ minLength: 1 }),
				file: screenshotFile,
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
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
				cropHeight: optionalCropParam,
				cropWidth: optionalCropParam,
				cropX: optionalCropParam,
				cropY: optionalCropParam,
				displayType: t.String({ maxLength: 100, minLength: 1 }),
				file: screenshotFile,
				language: t.String({ maxLength: 20, minLength: 1 }),
				versionId: t.String({ maxLength: 200, minLength: 1 }),
			}),
			detail: {
				description: "Upload a screenshot to App Store Connect",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.post(
		"/:appId/publishing/screenshots/split-preview",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PublishingService.splitPreview(
				body.displayType,
				body.file,
				body.parts,
				body.targetWidth,
				body.targetHeight,
			);
		},
		{
			body: t.Object({
				displayType: t.String({ maxLength: 100, minLength: 1 }),
				file: screenshotFile,
				parts: t.Numeric({ maximum: 10, minimum: 2 }),
				targetHeight: t.Optional(t.Numeric({ maximum: 10000, minimum: 1 })),
				targetWidth: t.Optional(t.Numeric({ maximum: 10000, minimum: 1 })),
			}),
			detail: {
				description: "Preview panorama split with dimensions and overlay lines",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.post(
		"/:appId/publishing/screenshots/split-upload",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
			return PublishingService.splitUpload(
				params.appId,
				body.versionId,
				body.language,
				body.displayType,
				body.file,
				body.parts,
				body.insertAt,
				body.targetWidth,
				body.targetHeight,
				cropParams,
			);
		},
		{
			body: t.Object({
				cropHeight: optionalCropParam,
				cropWidth: optionalCropParam,
				cropX: optionalCropParam,
				cropY: optionalCropParam,
				displayType: t.String({ maxLength: 100, minLength: 1 }),
				file: screenshotFile,
				insertAt: t.Optional(t.Numeric({ minimum: 0 })),
				language: t.String({ maxLength: 20, minLength: 1 }),
				parts: t.Numeric({ maximum: 10, minimum: 2 }),
				targetHeight: t.Optional(t.Numeric({ maximum: 10000, minimum: 1 })),
				targetWidth: t.Optional(t.Numeric({ maximum: 10000, minimum: 1 })),
				versionId: t.String({ maxLength: 200, minLength: 1 }),
			}),
			detail: {
				description:
					"Split a panorama image into parts and upload each as a screenshot",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.post(
		"/:appId/publishing/screenshots/copy",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PublishingService.copyScreenshots(
				params.appId,
				body.versionId,
				body.sourceLanguage,
				body.targetLanguage,
				body.displayType,
				body.copyLocalizations,
			);
		},
		{
			body: t.Object({
				copyLocalizations: t.Optional(t.Boolean()),
				displayType: t.Optional(t.String({ maxLength: 100, minLength: 1 })),
				sourceLanguage: t.String({ maxLength: 20, minLength: 1 }),
				targetLanguage: t.String({ maxLength: 20, minLength: 1 }),
				versionId: t.String({ maxLength: 200, minLength: 1 }),
			}),
			detail: {
				description:
					"Copy screenshots from one language to another within a version; optionally copy text localizations too",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.delete(
		"/:appId/publishing/screenshots/:screenshotId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
	.patch(
		"/:appId/publishing/versions/:versionId/copyright",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PublishingService.updateVersionCopyright(
				params.appId,
				params.versionId,
				body.copyright,
			);
		},
		{
			body: t.Object({
				copyright: t.String({ maxLength: 255 }),
			}),
			detail: {
				description: "Update version copyright",
				tags: ["Publishing"],
			},
			params: t.Object({
				appId: t.String({ format: "uuid" }),
				versionId: t.String({ minLength: 1 }),
			}),
		},
	)
	.get(
		"/:appId/publishing/versions/:versionId/review-detail",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PublishingService.getReviewDetail(params.appId, params.versionId);
		},
		{
			detail: {
				description: "Get app review detail for a version",
				tags: ["Publishing"],
			},
			params: t.Object({
				appId: t.String({ format: "uuid" }),
				versionId: t.String({ minLength: 1 }),
			}),
		},
	)
	.patch(
		"/:appId/publishing/versions/:versionId/review-detail",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PublishingService.updateReviewDetail(
				params.appId,
				params.versionId,
				body,
			);
		},
		{
			body: t.Object({
				contactEmail: t.Optional(t.String()),
				contactFirstName: t.Optional(t.String()),
				contactLastName: t.Optional(t.String()),
				contactPhone: t.Optional(t.String()),
				demoAccountName: t.Optional(t.String()),
				demoAccountPassword: t.Optional(t.String()),
				demoAccountRequired: t.Optional(t.Boolean()),
				notes: t.Optional(t.String({ maxLength: 4000 })),
			}),
			detail: {
				description: "Update app review detail for a version",
				tags: ["Publishing"],
			},
			params: t.Object({
				appId: t.String({ format: "uuid" }),
				versionId: t.String({ minLength: 1 }),
			}),
		},
	)
	.post(
		"/:appId/publishing/versions/:versionId/review-detail/attachments",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PublishingService.uploadReviewAttachment(
				params.appId,
				params.versionId,
				body.file,
			);
		},
		{
			body: t.Object({
				file: t.File(),
			}),
			detail: {
				description: "Upload a review attachment",
				tags: ["Publishing"],
			},
			params: t.Object({
				appId: t.String({ format: "uuid" }),
				versionId: t.String({ minLength: 1 }),
			}),
		},
	)
	.delete(
		"/:appId/publishing/review-attachments/:attachmentId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PublishingService.deleteReviewAttachment(
				params.appId,
				params.attachmentId,
			);
		},
		{
			detail: {
				description: "Delete a review attachment",
				tags: ["Publishing"],
			},
			params: t.Object({
				appId: t.String({ format: "uuid" }),
				attachmentId: t.String({ minLength: 1 }),
			}),
		},
	)
	.post(
		"/:appId/publishing/sync-versions",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PublishingService.syncVersions(params.appId);
		},
		{
			detail: {
				description: "Sync versions and localizations from App Store Connect",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	)
	.post(
		"/:appId/publishing/versions/:versionId/publish-localizations",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PublishingService.publishVersionLocalizations(
				params.appId,
				params.versionId,
			);
		},
		{
			detail: {
				description:
					"Push dirty version localization drafts to App Store Connect",
				tags: ["Publishing"],
			},
			params: t.Object({
				appId: t.String({ format: "uuid" }),
				versionId: t.String({ minLength: 1 }),
			}),
		},
	)
	.get(
		"/:appId/publishing/version",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
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
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PublishingService.submitForReview(params.appId);
		},
		{
			detail: {
				description:
					"Submit changes for store review (App Store or Google Play)",
				tags: ["Publishing"],
			},
			params: appIdParams,
		},
	);

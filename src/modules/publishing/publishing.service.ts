import { and, eq } from "drizzle-orm";
import type { ApiResource } from "node-app-store-connect-api";
import sharp from "sharp";
import type { StoreType } from "@/config/const";
import { AssetsService } from "@/modules/assets/assets.service";
import { ListingsService } from "@/modules/listings/listings.service";
import { createProvider } from "@/providers";
import { createAppStoreClient } from "@/providers/app-store/client";
import { decrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { apps, listings, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("publishing-service");

const EDITABLE_STATES = [
	"PREPARE_FOR_SUBMISSION",
	"DEVELOPER_REJECTED",
	"REJECTED",
];

function suggestNextVersion(versionString: string): string {
	const parts = versionString.split(".");
	if (parts.length < 2) return `${versionString}.1`;
	const patch = Number.parseInt(parts[parts.length - 1], 10);
	parts[parts.length - 1] = String(Number.isNaN(patch) ? 1 : patch + 1);
	return parts.join(".");
}

const REQUIRED_SIZES: Record<string, [number, number][]> = {
	APP_IPHONE_35: [[640, 1136], [1136, 640], [640, 1096], [1136, 600]],
	APP_IPHONE_40: [[640, 1136], [1136, 640]],
	APP_IPHONE_47: [[750, 1334], [1334, 750]],
	APP_IPHONE_55: [[1242, 2208], [2208, 1242]],
	APP_IPHONE_58: [[1125, 2436], [2436, 1125]],
	APP_IPHONE_61: [[828, 1792], [1792, 828], [1284, 2778], [2778, 1284]],
	APP_IPHONE_65: [[1242, 2688], [2688, 1242], [1284, 2778], [2778, 1284]],
	APP_IPHONE_67: [[1290, 2796], [2796, 1290]],
	APP_IPAD_PRO_129: [
		[2064, 2752], [2752, 2064],
		[2048, 2732], [2732, 2048],
	],
};

async function processScreenshot(
	inputBuffer: Buffer,
	displayType: string,
): Promise<{ buffer: Buffer; height: number; width: number }> {
	const image = sharp(inputBuffer);
	const meta = await image.metadata();
	const imgW = meta.width ?? 0;
	const imgH = meta.height ?? 0;

	if (imgW === 0 || imgH === 0) {
		throw new Error("Could not read image dimensions");
	}

	// Pick target size
	const sizes = REQUIRED_SIZES[displayType];
	if (!sizes?.length) {
		throw new Error(`Unknown display type: ${displayType}`);
	}

	const isPortrait = imgH >= imgW;
	const candidates = sizes.filter(([w, h]) =>
		isPortrait ? h >= w : w >= h,
	);
	const pool = candidates.length > 0 ? candidates : sizes;

	const imgAspect = imgW / imgH;
	let best = pool[0];
	let bestDiff = Math.abs(best[0] / best[1] - imgAspect);
	for (const size of pool) {
		const diff = Math.abs(size[0] / size[1] - imgAspect);
		if (diff < bestDiff) {
			best = size;
			bestDiff = diff;
		}
	}

	const [targetW, targetH] = best;

	// Crop to target aspect ratio (center crop), then resize
	const targetAspect = targetW / targetH;
	const srcAspect = imgW / imgH;

	let cropW: number;
	let cropH: number;
	if (srcAspect > targetAspect) {
		cropH = imgH;
		cropW = Math.round(imgH * targetAspect);
	} else {
		cropW = imgW;
		cropH = Math.round(imgW / targetAspect);
	}

	const processed = await sharp(inputBuffer)
		.extract({
			left: Math.round((imgW - cropW) / 2),
			top: Math.round((imgH - cropH) / 2),
			width: cropW,
			height: cropH,
		})
		.resize(targetW, targetH)
		.flatten({ background: { r: 255, g: 255, b: 255 } })
		.png({ compressionLevel: 6 })
		.toBuffer();

	log.info(
		{ from: `${imgW}x${imgH}`, to: `${targetW}x${targetH}` },
		"Processed screenshot",
	);

	return { buffer: processed, height: targetH, width: targetW };
}

function extractAscError(err: unknown): string {
	if (err instanceof Error) {
		// node-app-store-connect-api wraps ASC errors
		const msg = err.message;
		try {
			// Try to parse JSON error body from the message
			const jsonMatch = msg.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]);
				if (parsed.errors?.length) {
					return parsed.errors
						.map((e: { detail?: string; title?: string }) => e.detail || e.title)
						.join("; ");
				}
			}
		} catch {
			// Ignore parse errors
		}
		return msg;
	}
	return String(err);
}

const LISTING_FIELDS = [
	"fullDesc",
	"keywords",
	"marketingUrl",
	"privacyUrl",
	"promoText",
	"shortDesc",
	"supportUrl",
	"title",
	"whatsNew",
] as const;

export class PublishingService {
	static async getOverview(appId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		// Listing changes
		const dirtyDrafts = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, appId),
					eq(listings.isDirty, true),
					eq(listings.source, "draft"),
				),
			);

		const remoteListings = await db
			.select()
			.from(listings)
			.where(and(eq(listings.appId, appId), eq(listings.source, "remote")));

		const remoteByLang = new Map(remoteListings.map((l) => [l.language, l]));

		const listingChanges = dirtyDrafts
			.map((draft) => {
				const remote = remoteByLang.get(draft.language);
				const changedFields: string[] = [];
				for (const field of LISTING_FIELDS) {
					const draftVal = draft[field] ?? null;
					const remoteVal = remote?.[field] ?? null;
					if (draftVal !== remoteVal) {
						changedFields.push(field);
					}
				}
				return { fields: changedFields, language: draft.language };
			})
			.filter((c) => c.fields.length > 0);

		// Asset changes
		const assetChanges = await AssetsService.getDirtyCount(appId);

		// Version info (App Store only)
		let version: {
			isEditable: boolean;
			state: string;
			suggestedVersion: string | null;
			versionString: string;
		} | null = null;
		if (app.store.type === "app_store" && app.store.credentials) {
			try {
				const credentials = JSON.parse(decrypt(app.store.credentials));
				if (credentials.keyId) {
					const { readAll } = await createAppStoreClient(credentials);
					const { data: versions } = await readAll(
						`apps/${app.externalId}/appStoreVersions`,
					);
					if (versions?.length) {
						const latest = versions[0] as ApiResource;
						const state = (latest.attributes.appStoreState as string) ?? "";
						const versionString =
							(latest.attributes.versionString as string) ?? "";
						const isEditable = EDITABLE_STATES.includes(state);
						version = {
							isEditable,
							state,
							suggestedVersion: isEditable
								? null
								: suggestNextVersion(versionString),
							versionString,
						};
					}
				}
			} catch (err) {
				log.warn({ appId, err }, "Could not fetch version info");
			}
		}

		return {
			assets: assetChanges,
			hasPendingChanges: listingChanges.length > 0 || assetChanges.count > 0,
			listings: {
				changes: listingChanges,
				count: listingChanges.length,
			},
			version,
		};
	}

	static async listVersions(appId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			return { versions: [] };
		}

		try {
			const credentials = JSON.parse(decrypt(app.store.credentials));
			if (!credentials.keyId) return { versions: [] };

			const { readAll } = await createAppStoreClient(credentials);
			const { data: versions } = await readAll(
				`apps/${app.externalId}/appStoreVersions`,
			);

			if (!versions?.length) return { versions: [] };

			return {
				versions: (versions as ApiResource[]).map((v) => {
					const state = (v.attributes.appStoreState as string) ?? "";
					const versionString = (v.attributes.versionString as string) ?? "";
					return {
						id: v.id,
						isEditable: EDITABLE_STATES.includes(state),
						state,
						versionString,
					};
				}),
			};
		} catch (err) {
			log.warn({ appId, err }, "Could not fetch versions");
			return { versions: [] };
		}
	}

	static async getVersionLocalizations(appId: string, versionId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Version localizations are only available for App Store apps",
			});
			throw new Error("unreachable");
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		if (!credentials.keyId) {
			buildError("badRequest", { info: "Missing App Store credentials" });
			throw new Error("unreachable");
		}

		const { readAll } = await createAppStoreClient(credentials);

		// Fetch version info
		const { data: versions } = await readAll(
			`apps/${app.externalId}/appStoreVersions`,
		);
		const version = (versions as ApiResource[])?.find(
			(v) => v.id === versionId,
		);
		if (!version) {
			buildError("notFound", { info: "Version not found" });
			throw new Error("unreachable");
		}

		const state = (version.attributes.appStoreState as string) ?? "";
		const versionString = (version.attributes.versionString as string) ?? "";

		// Fetch version localizations (description, keywords, whatsNew, promoText, etc.)
		const { data: versionLocs } = await readAll(
			`appStoreVersions/${versionId}/appStoreVersionLocalizations`,
		);

		// Also fetch appInfo localizations for title/subtitle
		const { data: appInfos } = await readAll(`apps/${app.externalId}/appInfos`);
		let infoLocByLang = new Map<string, ApiResource>();
		if (appInfos?.length) {
			const latestInfo = appInfos[0] as ApiResource;
			const { data: infoLocs } = await readAll(
				`appInfos/${latestInfo.id}/appInfoLocalizations`,
			);
			infoLocByLang = new Map(
				((infoLocs ?? []) as ApiResource[]).map((l) => [
					l.attributes.locale as string,
					l,
				]),
			);
		}

		const localizations = ((versionLocs ?? []) as ApiResource[]).map((loc) => {
			const attrs = loc.attributes;
			const locale = attrs.locale as string;
			const infoLoc = infoLocByLang.get(locale);

			return {
				description: (attrs.description as string) ?? "",
				keywords: (attrs.keywords as string) ?? "",
				language: locale,
				marketingUrl: (attrs.marketingUrl as string) ?? undefined,
				promotionalText: (attrs.promotionalText as string) ?? undefined,
				subtitle: (infoLoc?.attributes?.subtitle as string) ?? "",
				supportUrl: (attrs.supportUrl as string) ?? undefined,
				title: (infoLoc?.attributes?.name as string) ?? "",
				whatsNew: (attrs.whatsNew as string) ?? undefined,
			};
		});

		return {
			localizations,
			state,
			versionId,
			versionString,
		};
	}

	static async getVersionScreenshots(appId: string, versionId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Screenshots are only available for App Store apps",
			});
			throw new Error("unreachable");
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		if (!credentials.keyId) {
			buildError("badRequest", { info: "Missing App Store credentials" });
			throw new Error("unreachable");
		}

		const { readAll } = await createAppStoreClient(credentials);

		const { data: versionLocs } = await readAll(
			`appStoreVersions/${versionId}/appStoreVersionLocalizations`,
		);

		if (!versionLocs?.length) {
			return { screenshots: [] };
		}

		const IPHONE_DISPLAY_TYPES = new Set([
			"APP_IPHONE_35",
			"APP_IPHONE_40",
			"APP_IPHONE_47",
			"APP_IPHONE_55",
			"APP_IPHONE_58",
			"APP_IPHONE_61",
			"APP_IPHONE_65",
			"APP_IPHONE_67",
		]);

		const DISPLAY_TYPE_LABELS: Record<string, string> = {
			APP_IPHONE_35: 'iPhone 3.5"',
			APP_IPHONE_40: 'iPhone 4.0"',
			APP_IPHONE_47: 'iPhone 4.7"',
			APP_IPHONE_55: 'iPhone 5.5"',
			APP_IPHONE_58: 'iPhone 5.8"',
			APP_IPHONE_61: 'iPhone 6.1"',
			APP_IPHONE_65: 'iPhone 6.5"',
			APP_IPHONE_67: 'iPhone 6.7"',
		};

		const screenshots: {
			deviceType: string;
			displayType: string;
			externalId: string;
			height: number | null;
			language: string;
			screenshotSetId: string;
			url: string;
			width: number | null;
		}[] = [];

		for (const loc of versionLocs as ApiResource[]) {
			const locale = loc.attributes.locale as string;

			const { data: screenshotSets } = await readAll(
				`appStoreVersionLocalizations/${loc.id}/appScreenshotSets`,
			);

			for (const set of (screenshotSets ?? []) as ApiResource[]) {
				const displayType =
					(set.attributes.screenshotDisplayType as string) ?? "";

				if (!IPHONE_DISPLAY_TYPES.has(displayType)) continue;

				const { data: items } = await readAll(
					`appScreenshotSets/${set.id}/appScreenshots`,
				);

				for (const item of (items ?? []) as ApiResource[]) {
					const attrs = item.attributes;
					const imageAsset = attrs.imageAsset as
						| Record<string, unknown>
						| undefined;

					let url = (imageAsset?.templateUrl as string) ?? "";
					const width = (imageAsset?.width as number) ?? null;
					const height = (imageAsset?.height as number) ?? null;

					// Replace template placeholders with actual dimensions
					if (url && width && height) {
						url = url
							.replace("{w}", String(width))
							.replace("{h}", String(height))
							.replace("{f}", "png");
					}

					screenshots.push({
						deviceType: DISPLAY_TYPE_LABELS[displayType] ?? displayType,
						displayType,
						externalId: item.id,
						height,
						language: locale,
						screenshotSetId: set.id,
						url,
						width,
					});
				}
			}
		}

		log.info(
			{ appId, count: screenshots.length, versionId },
			"Fetched version screenshots",
		);

		return { screenshots };
	}

	static async deleteScreenshot(appId: string, screenshotId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Screenshots are only available for App Store apps",
			});
			throw new Error("unreachable");
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		const { remove } = await createAppStoreClient(credentials);

		await remove({ id: screenshotId, type: "appScreenshots" });

		log.info(
			{ appId, screenshotId },
			"Deleted screenshot from App Store Connect",
		);

		return { deleted: true };
	}

	static async uploadScreenshot(
		appId: string,
		versionId: string,
		language: string,
		displayType: string,
		file: File,
	) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Screenshots are only available for App Store apps",
			});
			throw new Error("unreachable");
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		const client = await createAppStoreClient(credentials);

		// Find the localization for this language
		const { data: versionLocs } = await client.readAll(
			`appStoreVersions/${versionId}/appStoreVersionLocalizations`,
		);
		const loc = ((versionLocs ?? []) as ApiResource[]).find(
			(l) => l.attributes.locale === language,
		);
		if (!loc) {
			buildError("notFound", {
				info: `No localization found for language "${language}"`,
			});
			throw new Error("unreachable");
		}

		// Find or create screenshot set for this display type
		const { data: sets } = await client.readAll(
			`appStoreVersionLocalizations/${loc.id}/appScreenshotSets`,
		);
		let screenshotSet = ((sets ?? []) as ApiResource[]).find(
			(s) => s.attributes.screenshotDisplayType === displayType,
		);

		if (!screenshotSet) {
			try {
				const created = await client.create({
					attributes: { screenshotDisplayType: displayType },
					relationships: {
						appStoreVersionLocalization: loc,
					},
					type: "appScreenshotSets",
				});
				screenshotSet = created.data;
			} catch (err) {
				const detail = extractAscError(err);
				log.error(
					{ appId, detail, displayType, err, language },
					"Failed to create screenshot set",
				);
				buildError("storeApiError", {
					info: `Failed to create screenshot set: ${detail}`,
				});
			}
		}

		const rawBuffer = Buffer.from(await file.arrayBuffer());

		// Process image: crop to correct aspect ratio, resize, flatten alpha
		let processed: { buffer: Buffer; height: number; width: number };
		try {
			processed = await processScreenshot(rawBuffer, displayType);
		} catch (err) {
			log.error(
				{ appId, displayType, err, fileName: file.name },
				"Failed to process screenshot image",
			);
			buildError("badRequest", {
				info: `Image processing failed: ${err instanceof Error ? err.message : String(err)}`,
			});
			throw new Error("unreachable");
		}

		const pngName = file.name.replace(/\.\w+$/, ".png");

		try {
			// Create screenshot resource
			const screenshot = await client.create({
				attributes: {
					fileName: pngName,
					fileSize: processed.buffer.length,
				},
				relationships: {
					appScreenshotSet: screenshotSet,
				},
				type: "appScreenshots",
			});

			// 2. Upload binary data
			await client.uploadAsset(screenshot.data, processed.buffer);

			// 3. Poll until processed
			await client.pollForUploadSuccess(
				`appScreenshots/${screenshot.data.id}`,
				"screenshot",
			);

			log.info(
				{
					appId,
					fileName: pngName,
					screenshotId: screenshot.data.id,
					size: `${processed.width}x${processed.height}`,
				},
				"Uploaded screenshot to App Store Connect",
			);

			return { screenshotId: screenshot.data.id, uploaded: true };
		} catch (err) {
			const detail = extractAscError(err);
			log.error(
				{ appId, detail, displayType, err, fileName: pngName, language },
				"Failed to upload screenshot to App Store Connect",
			);
			buildError("storeApiError", {
				info: detail,
			});
		}
	}

	static async previewScreenshot(displayType: string, file: File) {
		const rawBuffer = Buffer.from(await file.arrayBuffer());

		try {
			const { buffer, height, width } = await processScreenshot(
				rawBuffer,
				displayType,
			);
			const base64 = buffer.toString("base64");

			return {
				height,
				preview: `data:image/png;base64,${base64}`,
				width,
			};
		} catch (err) {
			log.error(
				{ displayType, err, fileName: file.name },
				"Failed to process screenshot for preview",
			);
			buildError("badRequest", {
				info: `Image processing failed: ${err instanceof Error ? err.message : String(err)}`,
			});
			throw new Error("unreachable");
		}
	}

	static async reorderScreenshots(
		appId: string,
		screenshotSetId: string,
		screenshotIds: string[],
	) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Screenshots are only available for App Store apps",
			});
			throw new Error("unreachable");
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		const client = await createAppStoreClient(credentials);

		// PATCH relationships endpoint to reorder
		const url = `appScreenshotSets/${screenshotSetId}/relationships/appScreenshots`;
		const body = {
			data: screenshotIds.map((id) => ({
				id,
				type: "appScreenshots",
			})),
		};

		await client.postJson(url, body, { method: "PATCH" });

		log.info(
			{ appId, count: screenshotIds.length, screenshotSetId },
			"Reordered screenshots on App Store Connect",
		);

		return { reordered: true };
	}

	static async deleteAllScreenshots(appId: string, screenshotSetId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Screenshots are only available for App Store apps",
			});
			throw new Error("unreachable");
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		const { readAll, remove } = await createAppStoreClient(credentials);

		const { data: items } = await readAll(
			`appScreenshotSets/${screenshotSetId}/appScreenshots`,
		);

		let deleted = 0;
		for (const item of (items ?? []) as ApiResource[]) {
			await remove({ id: item.id, type: "appScreenshots" });
			deleted++;
		}

		log.info(
			{ appId, deleted, screenshotSetId },
			"Deleted all screenshots from set",
		);

		return { deleted };
	}

	static async publishAll(
		appId: string,
		options?: { submitForReview?: boolean },
	) {
		const app = await PublishingService.getAppWithStore(appId);

		// Publish listings
		const listingResult = await ListingsService.publish(appId);

		// Publish assets
		const assetResult = await AssetsService.publishAssets(appId);

		// Submit for review if requested (App Store only)
		if (options?.submitForReview && app.store.type === "app_store") {
			await PublishingService.submitForReview(appId);
		}

		log.info(
			{
				appId,
				assetsPublished: assetResult.published,
				listingsPublished: listingResult.published,
			},
			"All changes published",
		);

		return {
			assets: assetResult,
			listings: listingResult,
		};
	}

	static async getVersionInfo(appId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			return null;
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		if (!credentials.keyId) return null;

		const { readAll } = await createAppStoreClient(credentials);
		const { data: versions } = await readAll(
			`apps/${app.externalId}/appStoreVersions`,
		);

		if (!versions?.length) return null;

		const latest = versions[0] as ApiResource;
		const state = (latest.attributes.appStoreState as string) ?? "";
		return {
			isEditable: EDITABLE_STATES.includes(state),
			state,
			versionString: (latest.attributes.versionString as string) ?? "",
		};
	}

	static async createVersion(appId: string, versionString: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store") {
			buildError("badRequest", {
				info: "Version creation is only available for App Store apps",
			});
		}

		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const provider = createProvider(app.store.type as StoreType, credentials);
		const result = await provider.createVersion(app.externalId, versionString);

		log.info(
			{ appId, state: result.state, versionString: result.versionString },
			"Created new version",
		);

		return result;
	}

	static async submitForReview(appId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store") {
			buildError("badRequest", {
				info: "Submit for review is only available for App Store apps",
			});
			throw new Error("unreachable");
		}

		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const { create, readAll } = await createAppStoreClient(credentials);

		const { data: versions } = await readAll(
			`apps/${app.externalId}/appStoreVersions`,
		);

		if (!versions?.length) {
			buildError("notFound", { info: "No app store version found" });
			throw new Error("unreachable");
		}

		const latestVersion = versions[0] as ApiResource;
		const state = latestVersion.attributes.appStoreState as string;

		if (!EDITABLE_STATES.includes(state)) {
			buildError("badRequest", {
				info: `Cannot submit for review: version is in state "${state}". Must be in PREPARE_FOR_SUBMISSION, DEVELOPER_REJECTED, or REJECTED.`,
			});
			throw new Error("unreachable");
		}

		await create({
			relationships: {
				appStoreVersion: latestVersion,
			},
			type: "appStoreVersionSubmissions",
		});

		log.info(
			{ appId, versionId: latestVersion.id },
			"Submitted app for review",
		);

		return { submitted: true };
	}

	private static async getAppWithStore(appId: string) {
		const result = await db
			.select({ app: apps, store: stores })
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(eq(apps.id, appId))
			.limit(1);

		if (result.length === 0) {
			buildError("notFound", { info: "App not found" });
			throw new Error("unreachable");
		}

		return { ...result[0].app, store: result[0].store };
	}
}

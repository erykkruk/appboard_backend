import { and, desc, eq, notInArray } from "drizzle-orm";
import type { ApiResource } from "node-app-store-connect-api";
import sharp from "sharp";
import type { StoreType } from "@/config/const";
import { AssetsService } from "@/modules/assets/assets.service";
import { ListingsService } from "@/modules/listings/listings.service";
import { createProvider } from "@/providers";
import { createAppStoreClient } from "@/providers/app-store/client";
import { decrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import {
	apps,
	appVersions,
	listings,
	stores,
	versionLocalizations,
} from "@/utils/db/schema";
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
	APP_IPAD_PRO_129: [
		[2064, 2752],
		[2752, 2064],
		[2048, 2732],
		[2732, 2048],
	],
	APP_IPHONE_35: [
		[640, 1136],
		[1136, 640],
		[640, 1096],
		[1136, 600],
	],
	APP_IPHONE_40: [
		[640, 1136],
		[1136, 640],
	],
	APP_IPHONE_47: [
		[750, 1334],
		[1334, 750],
	],
	APP_IPHONE_55: [
		[1242, 2208],
		[2208, 1242],
	],
	APP_IPHONE_58: [
		[1125, 2436],
		[2436, 1125],
	],
	APP_IPHONE_61: [
		[828, 1792],
		[1792, 828],
		[1284, 2778],
		[2778, 1284],
	],
	APP_IPHONE_65: [
		[1242, 2688],
		[2688, 1242],
		[1284, 2778],
		[2778, 1284],
	],
	APP_IPHONE_67: [
		[1290, 2796],
		[2796, 1290],
	],
};

interface CropParams {
	x: number;
	y: number;
	width: number;
	height: number;
}

const MIN_SPLIT_PARTS = 2;
const MAX_SPLIT_PARTS = 10;
const MIN_PANORAMA_RATIO = 1.5;
const MAX_SCREENSHOTS_PER_SET = 10;
const MAX_PIXEL_COUNT = 100_000_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50 MB

async function processScreenshot(
	inputBuffer: Buffer,
	displayType: string,
	cropParams?: CropParams,
	targetSizeOverride?: [number, number],
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

	// Use crop area dimensions for orientation/aspect when user provided crop
	const refW = cropParams ? cropParams.width : imgW;
	const refH = cropParams ? cropParams.height : imgH;

	const isPortrait = refH >= refW;
	const candidates = sizes.filter(([w, h]) => (isPortrait ? h >= w : w >= h));
	const pool = candidates.length > 0 ? candidates : sizes;

	const refAspect = refW / refH;
	let best = pool[0];
	let bestDiff = Math.abs(best[0] / best[1] - refAspect);
	for (const size of pool) {
		const diff = Math.abs(size[0] / size[1] - refAspect);
		if (diff < bestDiff) {
			best = size;
			bestDiff = diff;
		}
	}

	const [targetW, targetH] = targetSizeOverride ?? best;

	let pipeline: sharp.Sharp;

	if (cropParams) {
		// User-defined crop region
		pipeline = sharp(inputBuffer).extract({
			height: Math.round(cropParams.height),
			left: Math.round(cropParams.x),
			top: Math.round(cropParams.y),
			width: Math.round(cropParams.width),
		});
	} else {
		// Auto center-crop to target aspect ratio
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

		pipeline = sharp(inputBuffer).extract({
			height: cropH,
			left: Math.round((imgW - cropW) / 2),
			top: Math.round((imgH - cropH) / 2),
			width: cropW,
		});
	}

	const processed = await pipeline
		.resize(targetW, targetH)
		.flatten({ background: { b: 255, g: 255, r: 255 } })
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
						.map(
							(e: { detail?: string; title?: string }) => e.detail || e.title,
						)
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

		// Version info (App Store only) — use cached data
		let version: {
			isEditable: boolean;
			state: string;
			suggestedVersion: string | null;
			versionString: string;
		} | null = null;
		if (app.store.type === "app_store") {
			const cachedVersions = await db
				.select()
				.from(appVersions)
				.where(eq(appVersions.appId, appId));

			if (cachedVersions.length > 0) {
				const latest = cachedVersions[0];
				version = {
					isEditable: latest.isEditable,
					state: latest.state,
					suggestedVersion: latest.isEditable
						? null
						: suggestNextVersion(latest.versionString),
					versionString: latest.versionString,
				};
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

	static async syncVersions(appId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			return { source: "cache" as const, synced: 0 };
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		if (!credentials.keyId) {
			return { source: "cache" as const, synced: 0 };
		}

		try {
			const { readAll } = await createAppStoreClient(credentials);
			const { data: ascVersions } = await readAll(
				`apps/${app.externalId}/appStoreVersions`,
			);

			if (!ascVersions?.length) {
				return { source: "live" as const, synced: 0 };
			}

			// Fetch appInfo localizations for title/subtitle
			const { data: appInfos } = await readAll(
				`apps/${app.externalId}/appInfos`,
			);
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

			let synced = 0;
			const now = new Date();

			for (const v of ascVersions as ApiResource[]) {
				const state = (v.attributes.appStoreState as string) ?? "";
				const versionString = (v.attributes.versionString as string) ?? "";
				const copyright = (v.attributes.copyright as string) ?? "";
				const isEditable = EDITABLE_STATES.includes(state);

				// Upsert app_versions
				const [dbVersion] = await db
					.insert(appVersions)
					.values({
						appId,
						copyright,
						externalId: v.id,
						isEditable,
						state,
						syncedAt: now,
						versionString,
					})
					.onConflictDoUpdate({
						set: {
							copyright,
							isEditable,
							state,
							syncedAt: now,
							versionString,
						},
						target: [appVersions.appId, appVersions.externalId],
					})
					.returning();

				// Fetch localizations for this version
				const { data: versionLocs } = await readAll(
					`appStoreVersions/${v.id}/appStoreVersionLocalizations`,
				);

				const ascLocales: string[] = [];

				for (const loc of (versionLocs ?? []) as ApiResource[]) {
					const attrs = loc.attributes;
					const locale = attrs.locale as string;
					ascLocales.push(locale);
					const infoLoc = infoLocByLang.get(locale);

					await db
						.insert(versionLocalizations)
						.values({
							appId,
							description: (attrs.description as string) ?? "",
							externalId: loc.id,
							keywords: (attrs.keywords as string) ?? "",
							language: locale,
							marketingUrl: (attrs.marketingUrl as string) ?? undefined,
							promotionalText: (attrs.promotionalText as string) ?? undefined,
							source: "remote",
							subtitle: (infoLoc?.attributes?.subtitle as string) ?? "",
							supportUrl: (attrs.supportUrl as string) ?? undefined,
							syncedAt: now,
							title: (infoLoc?.attributes?.name as string) ?? "",
							versionId: dbVersion.id,
							whatsNew: (attrs.whatsNew as string) ?? undefined,
						})
						.onConflictDoUpdate({
							set: {
								description: (attrs.description as string) ?? "",
								externalId: loc.id,
								keywords: (attrs.keywords as string) ?? "",
								marketingUrl: (attrs.marketingUrl as string) ?? undefined,
								promotionalText: (attrs.promotionalText as string) ?? undefined,
								subtitle: (infoLoc?.attributes?.subtitle as string) ?? "",
								supportUrl: (attrs.supportUrl as string) ?? undefined,
								syncedAt: now,
								title: (infoLoc?.attributes?.name as string) ?? "",
								whatsNew: (attrs.whatsNew as string) ?? undefined,
							},
							target: [
								versionLocalizations.versionId,
								versionLocalizations.language,
								versionLocalizations.source,
							],
						});
				}

				// Remove localizations that no longer exist in ASC
				if (ascLocales.length > 0) {
					const deleted = await db
						.delete(versionLocalizations)
						.where(
							and(
								eq(versionLocalizations.versionId, dbVersion.id),
								notInArray(versionLocalizations.language, ascLocales),
							),
						)
						.returning({ language: versionLocalizations.language });

					if (deleted.length > 0) {
						log.info(
							{
								appId,
								removed: deleted.map((d) => d.language),
								versionId: v.id,
							},
							"Removed stale localizations not in ASC",
						);
					}
				}

				synced++;
			}

			await db
				.update(apps)
				.set({ lastSyncedAt: new Date() })
				.where(eq(apps.id, appId));

			log.info({ appId, synced }, "Synced versions from ASC");
			return { source: "live" as const, synced };
		} catch (err) {
			log.warn({ appId, err }, "Could not sync versions from ASC, using cache");
			return { source: "cache" as const, synced: 0 };
		}
	}

	static async listVersions(appId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			return { source: "live" as const, versions: [] };
		}

		// Try to sync from ASC first
		const syncResult = await PublishingService.syncVersions(appId);

		// Read from local DB
		const cachedVersions = await db
			.select()
			.from(appVersions)
			.where(eq(appVersions.appId, appId));

		return {
			source: syncResult.source,
			versions: cachedVersions.map((v) => ({
				id: v.externalId,
				isEditable: v.isEditable,
				state: v.state,
				versionString: v.versionString,
			})),
		};
	}

	static async getVersionLocalizations(appId: string, versionId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Version localizations are only available for App Store apps",
			});
			throw new Error("unreachable");
		}

		// Find the cached version by externalId
		let [dbVersion] = await db
			.select()
			.from(appVersions)
			.where(
				and(
					eq(appVersions.appId, appId),
					eq(appVersions.externalId, versionId),
				),
			)
			.limit(1);

		// If no cached version, try syncing first
		if (!dbVersion) {
			await PublishingService.syncVersions(appId);
			const result = await db
				.select()
				.from(appVersions)
				.where(
					and(
						eq(appVersions.appId, appId),
						eq(appVersions.externalId, versionId),
					),
				)
				.limit(1);
			dbVersion = result[0];
		}

		if (!dbVersion) {
			buildError("notFound", { info: "Version not found" });
			throw new Error("unreachable");
		}

		// Get remote localizations
		const remoteLocs = await db
			.select()
			.from(versionLocalizations)
			.where(
				and(
					eq(versionLocalizations.versionId, dbVersion.id),
					eq(versionLocalizations.source, "remote"),
				),
			);

		// Get draft localizations
		const draftLocs = await db
			.select()
			.from(versionLocalizations)
			.where(
				and(
					eq(versionLocalizations.versionId, dbVersion.id),
					eq(versionLocalizations.source, "draft"),
				),
			);

		const draftByLang = new Map(draftLocs.map((d) => [d.language, d]));

		// Merge: draft over remote (same pattern as listings)
		const localizations = remoteLocs.map((remote) => {
			const draft = draftByLang.get(remote.language);
			const merged = draft ?? remote;
			return {
				description: merged.description ?? "",
				isDirty: draft?.isDirty ?? false,
				keywords: merged.keywords ?? "",
				language: merged.language,
				localizationId: remote.externalId ?? remote.id,
				marketingUrl: merged.marketingUrl ?? undefined,
				promotionalText: merged.promotionalText ?? undefined,
				subtitle: merged.subtitle ?? "",
				supportUrl: merged.supportUrl ?? undefined,
				title: merged.title ?? "",
				whatsNew: merged.whatsNew ?? undefined,
			};
		});

		// Determine source based on sync freshness
		const isFresh =
			dbVersion.syncedAt && Date.now() - dbVersion.syncedAt.getTime() < 60_000;
		const source = isFresh ? ("live" as const) : ("cache" as const);

		return {
			copyright: dbVersion.copyright ?? "",
			localizations,
			source,
			state: dbVersion.state,
			versionId,
			versionString: dbVersion.versionString,
		};
	}

	static async updateVersionCopyright(
		appId: string,
		versionId: string,
		copyright: string,
	) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Copyright is only available for App Store apps",
			});
		}

		// Save locally first
		await db
			.update(appVersions)
			.set({ copyright, copyrightDirty: true })
			.where(
				and(
					eq(appVersions.appId, appId),
					eq(appVersions.externalId, versionId),
				),
			);

		// Try to push to ASC
		let savedLocally = false;
		try {
			const credentials = JSON.parse(decrypt(app.store.credentials!));
			const client = await createAppStoreClient(credentials);
			await client.update(
				{ id: versionId, type: "appStoreVersions" },
				{ attributes: { copyright } },
			);

			// Mark as clean after successful push
			await db
				.update(appVersions)
				.set({ copyrightDirty: false })
				.where(
					and(
						eq(appVersions.appId, appId),
						eq(appVersions.externalId, versionId),
					),
				);
		} catch (err) {
			log.warn(
				{ appId, err, versionId },
				"Could not push copyright to ASC, saved locally",
			);
			savedLocally = true;
		}

		log.info({ appId, savedLocally, versionId }, "Updated version copyright");
		return { savedLocally, updated: true };
	}

	static async getReviewDetail(appId: string, versionId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Review detail is only available for App Store apps",
			});
			throw new Error("unreachable");
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		const client = await createAppStoreClient(credentials);

		try {
			const { data: reviewDetail } = await client.read(
				`appStoreVersions/${versionId}/appStoreReviewDetail`,
			);

			if (!reviewDetail) {
				return { reviewDetail: null };
			}

			const detail = reviewDetail as ApiResource;
			const attrs = detail.attributes;

			// Fetch attachments
			let attachments: {
				id: string;
				fileName: string;
				fileSize: number;
				url: string;
			}[] = [];

			try {
				const { data: attachmentData } = await client.readAll(
					`appStoreReviewDetails/${detail.id}/appStoreReviewAttachments`,
				);

				attachments = ((attachmentData ?? []) as ApiResource[]).map((att) => {
					const a = att.attributes;
					const asset = a.uploadOperations
						? undefined
						: (a.imageAsset as Record<string, unknown> | undefined);
					let url = "";
					if (asset?.templateUrl) {
						url = (asset.templateUrl as string)
							.replace("{w}", String(asset.width ?? 0))
							.replace("{h}", String(asset.height ?? 0))
							.replace("{f}", "png");
					}
					return {
						fileName: (a.fileName as string) ?? "",
						fileSize: (a.fileSize as number) ?? 0,
						id: att.id,
						url,
					};
				});
			} catch {
				log.warn({ appId, versionId }, "Could not fetch review attachments");
			}

			return {
				reviewDetail: {
					attachments,
					contactEmail: (attrs.contactEmail as string) ?? "",
					contactFirstName: (attrs.contactFirstName as string) ?? "",
					contactLastName: (attrs.contactLastName as string) ?? "",
					contactPhone: (attrs.contactPhone as string) ?? "",
					demoAccountName: (attrs.demoAccountName as string) ?? "",
					demoAccountPassword: (attrs.demoAccountPassword as string) ?? "",
					demoAccountRequired: (attrs.demoAccountRequired as boolean) ?? false,
					notes: (attrs.notes as string) ?? "",
					reviewDetailId: detail.id,
				},
			};
		} catch (err) {
			// If 404, no review detail exists yet
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("404") || msg.includes("not found")) {
				return { reviewDetail: null };
			}
			const detail = extractAscError(err);
			log.error(
				{ appId, detail, err, versionId },
				"Failed to fetch review detail",
			);
			buildError("storeApiError", {
				info: `Failed to fetch review detail: ${detail}`,
			});
			throw new Error("unreachable");
		}
	}

	static async updateReviewDetail(
		appId: string,
		versionId: string,
		data: {
			contactFirstName?: string;
			contactLastName?: string;
			contactPhone?: string;
			contactEmail?: string;
			demoAccountName?: string;
			demoAccountPassword?: string;
			demoAccountRequired?: boolean;
			notes?: string;
		},
	) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Review detail is only available for App Store apps",
			});
		}

		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const client = await createAppStoreClient(credentials);

		const attributes: Record<string, string | boolean> = {};
		if (data.contactFirstName !== undefined)
			attributes.contactFirstName = data.contactFirstName;
		if (data.contactLastName !== undefined)
			attributes.contactLastName = data.contactLastName;
		if (data.contactPhone !== undefined)
			attributes.contactPhone = data.contactPhone;
		if (data.contactEmail !== undefined)
			attributes.contactEmail = data.contactEmail;
		if (data.demoAccountName !== undefined)
			attributes.demoAccountName = data.demoAccountName;
		if (data.demoAccountPassword !== undefined)
			attributes.demoAccountPassword = data.demoAccountPassword;
		if (data.demoAccountRequired !== undefined)
			attributes.demoAccountRequired = data.demoAccountRequired;
		if (data.notes !== undefined) attributes.notes = data.notes;

		try {
			// Try to get existing review detail
			let reviewDetailId: string | null = null;
			try {
				const { data: existing } = await client.read(
					`appStoreVersions/${versionId}/appStoreReviewDetail`,
				);
				if (existing) {
					reviewDetailId = (existing as ApiResource).id;
				}
			} catch {
				// No existing detail
			}

			if (reviewDetailId) {
				await client.update(
					{ id: reviewDetailId, type: "appStoreReviewDetails" },
					{ attributes },
				);
			} else {
				await client.create({
					attributes,
					relationships: {
						appStoreVersion: { id: versionId, type: "appStoreVersions" },
					},
					type: "appStoreReviewDetails",
				});
			}
		} catch (err) {
			const detail = extractAscError(err);
			log.error(
				{ appId, detail, err, versionId },
				"Failed to update review detail",
			);
			buildError("storeApiError", {
				info: `Failed to update review detail: ${detail}`,
			});
		}

		log.info({ appId, versionId }, "Updated review detail");
		return { updated: true };
	}

	static async uploadReviewAttachment(
		appId: string,
		versionId: string,
		file: File,
	) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Review attachments are only available for App Store apps",
			});
			throw new Error("unreachable");
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		const client = await createAppStoreClient(credentials);

		// Get review detail ID
		let reviewDetailId: string;
		try {
			const { data: existing } = await client.read(
				`appStoreVersions/${versionId}/appStoreReviewDetail`,
			);
			if (!existing) {
				buildError("notFound", {
					info: "Review detail not found. Save review information first.",
				});
				throw new Error("unreachable");
			}
			reviewDetailId = (existing as ApiResource).id;
		} catch (err) {
			if (err && typeof err === "object" && "status" in err) throw err;
			const detail = extractAscError(err);
			buildError("storeApiError", {
				info: `Failed to get review detail: ${detail}`,
			});
			throw new Error("unreachable");
		}

		const buffer = Buffer.from(await file.arrayBuffer());

		try {
			const attachment = (await client.create({
				attributes: {
					fileName: file.name,
					fileSize: buffer.length,
				},
				relationships: {
					appStoreReviewDetail: {
						id: reviewDetailId,
						type: "appStoreReviewDetails",
					},
				},
				type: "appStoreReviewAttachments",
			})) as unknown as ApiResource;

			await client.uploadAsset(attachment, buffer);
			await client.pollForUploadSuccess(
				`appStoreReviewAttachments/${attachment.id}`,
				"reviewAttachment",
			);

			log.info(
				{ appId, attachmentId: attachment.id, fileName: file.name },
				"Uploaded review attachment",
			);

			return { attachmentId: attachment.id, uploaded: true };
		} catch (err) {
			if (err && typeof err === "object" && "status" in err) throw err;
			const detail = extractAscError(err);
			log.error(
				{ appId, detail, err, fileName: file.name },
				"Failed to upload review attachment",
			);
			buildError("storeApiError", {
				info: `Failed to upload attachment: ${detail}`,
			});
		}
	}

	static async deleteReviewAttachment(appId: string, attachmentId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Review attachments are only available for App Store apps",
			});
			throw new Error("unreachable");
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		const { remove } = await createAppStoreClient(credentials);

		await remove({ id: attachmentId, type: "appStoreReviewAttachments" });

		log.info({ appId, attachmentId }, "Deleted review attachment");
		return { deleted: true };
	}

	static async updateVersionLocalization(
		appId: string,
		versionId: string,
		localizationId: string,
		data: {
			description?: string;
			keywords?: string;
			marketingUrl?: string;
			promotionalText?: string;
			subtitle?: string;
			supportUrl?: string;
			title?: string;
			whatsNew?: string;
		},
	) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Version localizations are only available for App Store apps",
			});
		}

		// Find the cached version by externalId (versionId is ASC external ID)
		const [dbVersion] = await db
			.select()
			.from(appVersions)
			.where(
				and(
					eq(appVersions.appId, appId),
					eq(appVersions.externalId, versionId),
				),
			)
			.limit(1);

		if (!dbVersion) {
			buildError("notFound", { info: "Version not found in local cache" });
			throw new Error("unreachable");
		}

		// Find the remote localization to get language
		const [remoteLoc] = await db
			.select()
			.from(versionLocalizations)
			.where(
				and(
					eq(versionLocalizations.versionId, dbVersion.id),
					eq(versionLocalizations.source, "remote"),
					eq(versionLocalizations.externalId, localizationId),
				),
			)
			.limit(1);

		if (!remoteLoc) {
			buildError("notFound", { info: "Localization not found" });
			throw new Error("unreachable");
		}

		// Build the draft data: start with remote values, overlay provided fields
		const draftValues = {
			appId,
			description: data.description ?? remoteLoc.description,
			externalId: localizationId,
			isDirty: true,
			keywords: data.keywords ?? remoteLoc.keywords,
			language: remoteLoc.language,
			marketingUrl: data.marketingUrl ?? remoteLoc.marketingUrl,
			promotionalText: data.promotionalText ?? remoteLoc.promotionalText,
			source: "draft" as const,
			subtitle: data.subtitle ?? remoteLoc.subtitle,
			supportUrl: data.supportUrl ?? remoteLoc.supportUrl,
			title: data.title ?? remoteLoc.title,
			versionId: dbVersion.id,
			whatsNew: data.whatsNew ?? remoteLoc.whatsNew,
		};

		// Upsert draft
		await db
			.insert(versionLocalizations)
			.values(draftValues)
			.onConflictDoUpdate({
				set: {
					description: draftValues.description,
					isDirty: true,
					keywords: draftValues.keywords,
					marketingUrl: draftValues.marketingUrl,
					promotionalText: draftValues.promotionalText,
					subtitle: draftValues.subtitle,
					supportUrl: draftValues.supportUrl,
					title: draftValues.title,
					whatsNew: draftValues.whatsNew,
				},
				target: [
					versionLocalizations.versionId,
					versionLocalizations.language,
					versionLocalizations.source,
				],
			});

		log.info(
			{ appId, fields: Object.keys(data), localizationId, savedLocally: true },
			"Saved version localization draft locally",
		);

		return { savedLocally: true, updated: true };
	}

	static async publishVersionLocalizations(appId: string, versionId: string) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Version localizations are only available for App Store apps",
			});
			throw new Error("unreachable");
		}

		// Find the cached version
		const [dbVersion] = await db
			.select()
			.from(appVersions)
			.where(
				and(
					eq(appVersions.appId, appId),
					eq(appVersions.externalId, versionId),
				),
			)
			.limit(1);

		if (!dbVersion) {
			buildError("notFound", { info: "Version not found in local cache" });
			throw new Error("unreachable");
		}

		// Get dirty drafts
		const dirtyDrafts = await db
			.select()
			.from(versionLocalizations)
			.where(
				and(
					eq(versionLocalizations.versionId, dbVersion.id),
					eq(versionLocalizations.source, "draft"),
					eq(versionLocalizations.isDirty, true),
				),
			);

		if (dirtyDrafts.length === 0) {
			return { published: 0 };
		}

		let credentials: Record<string, string>;
		try {
			credentials = JSON.parse(decrypt(app.store.credentials));
		} catch {
			buildError("badRequest", { info: "Invalid App Store credentials" });
			throw new Error("unreachable");
		}

		let client: Awaited<ReturnType<typeof createAppStoreClient>>;
		try {
			client = await createAppStoreClient(credentials);
		} catch (err) {
			log.warn({ appId, err }, "Could not connect to ASC for publish");
			return {
				error: "store_unavailable",
				published: 0,
				savedLocally: true,
			};
		}

		let published = 0;
		const errors: string[] = [];

		for (const draft of dirtyDrafts) {
			if (!draft.externalId) continue;

			try {
				// Push version localization fields
				const versionLocAttrs: Record<string, string> = {};
				if (draft.description != null)
					versionLocAttrs.description = draft.description;
				if (draft.keywords != null) versionLocAttrs.keywords = draft.keywords;
				if (draft.whatsNew != null) versionLocAttrs.whatsNew = draft.whatsNew;
				if (draft.promotionalText != null)
					versionLocAttrs.promotionalText = draft.promotionalText;
				if (draft.marketingUrl != null)
					versionLocAttrs.marketingUrl = draft.marketingUrl;
				if (draft.supportUrl != null)
					versionLocAttrs.supportUrl = draft.supportUrl;

				if (Object.keys(versionLocAttrs).length > 0) {
					await client.update(
						{
							id: draft.externalId,
							type: "appStoreVersionLocalizations",
						},
						{ attributes: versionLocAttrs },
					);
				}

				// Push title/subtitle via appInfoLocalizations
				if (draft.title != null || draft.subtitle != null) {
					try {
						const { data: versionLoc } = await client.read(
							`appStoreVersionLocalizations/${draft.externalId}`,
						);
						const locale =
							((versionLoc as ApiResource)?.attributes?.locale as string) ?? "";

						if (locale) {
							const { data: appInfos } = await client.readAll(
								`apps/${app.externalId}/appInfos`,
							);
							if (appInfos?.length) {
								const latestInfo = appInfos[0] as ApiResource;
								const { data: infoLocs } = await client.readAll(
									`appInfos/${latestInfo.id}/appInfoLocalizations`,
								);
								const infoLoc = ((infoLocs ?? []) as ApiResource[]).find(
									(l) => l.attributes.locale === locale,
								);
								if (infoLoc) {
									const infoAttrs: Record<string, string> = {};
									if (draft.title != null) infoAttrs.name = draft.title;
									if (draft.subtitle != null)
										infoAttrs.subtitle = draft.subtitle;
									await client.update(
										{
											id: infoLoc.id,
											type: "appInfoLocalizations",
										},
										{ attributes: infoAttrs },
									);
								} else {
									errors.push(
										`${draft.language}: Could not find appInfoLocalization for title/subtitle`,
									);
								}
							}
						}
					} catch (err) {
						const detail = extractAscError(err);
						log.warn(
							{ appId, detail, err, language: draft.language },
							"Failed to push title/subtitle to ASC",
						);
						errors.push(`${draft.language} title/subtitle: ${detail}`);
					}
				}

				// Update remote copy with draft values
				await db
					.update(versionLocalizations)
					.set({
						description: draft.description,
						keywords: draft.keywords,
						marketingUrl: draft.marketingUrl,
						promotionalText: draft.promotionalText,
						subtitle: draft.subtitle,
						supportUrl: draft.supportUrl,
						syncedAt: new Date(),
						title: draft.title,
						whatsNew: draft.whatsNew,
					})
					.where(
						and(
							eq(versionLocalizations.versionId, dbVersion.id),
							eq(versionLocalizations.language, draft.language),
							eq(versionLocalizations.source, "remote"),
						),
					);

				// Mark draft as clean
				await db
					.update(versionLocalizations)
					.set({ isDirty: false })
					.where(eq(versionLocalizations.id, draft.id));

				published++;
			} catch (err) {
				const detail = extractAscError(err);
				log.error(
					{ appId, detail, err, language: draft.language },
					"Failed to publish version localization",
				);
				errors.push(`${draft.language}: ${detail}`);
			}
		}

		// Also push dirty copyright if needed
		if (dbVersion.copyrightDirty && dbVersion.copyright) {
			try {
				await client.update(
					{ id: versionId, type: "appStoreVersions" },
					{ attributes: { copyright: dbVersion.copyright } },
				);
				await db
					.update(appVersions)
					.set({ copyrightDirty: false })
					.where(eq(appVersions.id, dbVersion.id));
			} catch (err) {
				log.warn({ appId, err }, "Failed to push copyright to ASC");
				errors.push(`copyright: ${extractAscError(err)}`);
			}
		}

		log.info(
			{ appId, errors: errors.length, published, versionId },
			"Published version localizations",
		);

		return {
			...(errors.length > 0 ? { errors } : {}),
			published,
		};
	}

	static async addVersionLocalization(
		appId: string,
		versionId: string,
		locale: string,
	) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Version localizations are only available for App Store apps",
			});
		}

		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const client = await createAppStoreClient(credentials);

		try {
			await client.create({
				attributes: { locale },
				relationships: {
					appStoreVersion: { id: versionId, type: "appStoreVersions" },
				},
				type: "appStoreVersionLocalizations",
			});
		} catch (err) {
			const detail = extractAscError(err);
			log.error(
				{ appId, detail, err, locale, versionId },
				"Failed to add version localization",
			);
			buildError("storeApiError", {
				info: `Failed to add localization: ${detail}`,
			});
		}

		log.info({ appId, locale, versionId }, "Added version localization");

		return { added: true, language: locale };
	}

	static async addVersionLocalizationWithTranslation(
		appId: string,
		versionId: string,
		locale: string,
		sourceLocale: string,
	) {
		// 1. Create the locale in ASC
		await PublishingService.addVersionLocalization(appId, versionId, locale);

		// 2. Sync to get the new localization in DB
		await PublishingService.syncVersions(appId);

		// 3. Find the DB version
		const [dbVersion] = await db
			.select()
			.from(appVersions)
			.where(
				and(
					eq(appVersions.appId, appId),
					eq(appVersions.externalId, versionId),
				),
			)
			.limit(1);

		if (!dbVersion) {
			buildError("notFound", { info: "Version not found after sync" });
			throw new Error("unreachable");
		}

		// 4. Get source localization data
		const [sourceLoc] = await db
			.select()
			.from(versionLocalizations)
			.where(
				and(
					eq(versionLocalizations.versionId, dbVersion.id),
					eq(versionLocalizations.language, sourceLocale),
					eq(versionLocalizations.source, "remote"),
				),
			)
			.limit(1);

		if (!sourceLoc) {
			log.warn(
				{ appId, sourceLocale },
				"Source localization not found, skipping translation",
			);
			return { added: true, language: locale, translated: false };
		}

		// 5. Collect non-empty text fields
		const fields: Record<string, string> = {};
		if (sourceLoc.title?.trim()) fields.title = sourceLoc.title;
		if (sourceLoc.subtitle?.trim()) fields.subtitle = sourceLoc.subtitle;
		if (sourceLoc.description?.trim())
			fields.description = sourceLoc.description;
		if (sourceLoc.keywords?.trim()) fields.keywords = sourceLoc.keywords;
		if (sourceLoc.promotionalText?.trim())
			fields.promotionalText = sourceLoc.promotionalText;
		if (sourceLoc.whatsNew?.trim()) fields.whatsNew = sourceLoc.whatsNew;

		if (Object.keys(fields).length === 0) {
			log.info({ appId, sourceLocale }, "No text fields to translate");
			return { added: true, language: locale, translated: false };
		}

		// 6. Get app info for contextual translation
		const [appInfo] = await db
			.select({ name: apps.name, platform: apps.platform })
			.from(apps)
			.where(eq(apps.id, appId))
			.limit(1);

		// 7. Translate via AI
		let translations: Record<string, string>;
		try {
			const { AIService } = await import("@/modules/ai/ai.service");
			const result = await AIService.translateLocalization(
				appId,
				appInfo?.name ?? "Unknown App",
				appInfo?.platform ?? "ios",
				fields,
				sourceLocale,
				locale,
			);
			translations = result.translations;
		} catch (err) {
			log.warn(
				{ appId, err, locale, sourceLocale },
				"AI translation failed, language was added without translations",
			);
			return { added: true, language: locale, translated: false };
		}

		// 8. Find the new localization's externalId
		const [newLoc] = await db
			.select()
			.from(versionLocalizations)
			.where(
				and(
					eq(versionLocalizations.versionId, dbVersion.id),
					eq(versionLocalizations.language, locale),
					eq(versionLocalizations.source, "remote"),
				),
			)
			.limit(1);

		if (!newLoc?.externalId) {
			log.warn(
				{ appId, locale },
				"New localization not found after sync, cannot save translations",
			);
			return { added: true, language: locale, translated: false };
		}

		// 9. Save translated fields as draft
		await PublishingService.updateVersionLocalization(
			appId,
			versionId,
			newLoc.externalId,
			translations,
		);

		log.info(
			{ appId, fields: Object.keys(translations), locale, sourceLocale },
			"Added localization with AI translation",
		);

		return { added: true, language: locale, translated: true };
	}

	static async deleteVersionLocalization(
		appId: string,
		localizationId: string,
	) {
		const app = await PublishingService.getAppWithStore(appId);

		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Version localizations are only available for App Store apps",
			});
		}

		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const { remove } = await createAppStoreClient(credentials);

		try {
			await remove({
				id: localizationId,
				type: "appStoreVersionLocalizations",
			});
		} catch (err) {
			const detail = extractAscError(err);
			log.error(
				{ appId, detail, err, localizationId },
				"Failed to delete version localization",
			);
			buildError("storeApiError", {
				info: `Failed to delete localization: ${detail}`,
			});
		}

		log.info({ appId, localizationId }, "Deleted version localization");

		return { deleted: true };
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
		cropParams?: CropParams,
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
				// node-app-store-connect-api create() returns ApiResource directly
				screenshotSet = (await client.create({
					attributes: { screenshotDisplayType: displayType },
					relationships: {
						appStoreVersionLocalization: loc,
					},
					type: "appScreenshotSets",
				})) as unknown as ApiResource;
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
			processed = await processScreenshot(rawBuffer, displayType, cropParams);
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
			// node-app-store-connect-api create() returns ApiResource directly (not wrapped in { data })
			const screenshot = (await client.create({
				attributes: {
					fileName: pngName,
					fileSize: processed.buffer.length,
				},
				relationships: {
					appScreenshotSet: screenshotSet,
				},
				type: "appScreenshots",
			})) as unknown as ApiResource;

			// 2. Upload binary data
			await client.uploadAsset(screenshot, processed.buffer);

			// 3. Poll until processed
			await client.pollForUploadSuccess(
				`appScreenshots/${screenshot.id}`,
				"screenshot",
			);

			log.info(
				{
					appId,
					fileName: pngName,
					screenshotId: screenshot.id,
					size: `${processed.width}x${processed.height}`,
				},
				"Uploaded screenshot to App Store Connect",
			);

			return { screenshotId: screenshot.id, uploaded: true };
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

	static async previewScreenshot(
		displayType: string,
		file: File,
		cropParams?: CropParams,
	) {
		const rawBuffer = Buffer.from(await file.arrayBuffer());

		try {
			const { buffer, height, width } = await processScreenshot(
				rawBuffer,
				displayType,
				cropParams,
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

	private static validateSplitParams(
		displayType: string,
		imgWidth: number,
		imgHeight: number,
		parts: number,
		skipPanoramaCheck = false,
	) {
		if (parts < MIN_SPLIT_PARTS || parts > MAX_SPLIT_PARTS) {
			buildError("badRequest", {
				info: `Parts must be between ${MIN_SPLIT_PARTS} and ${MAX_SPLIT_PARTS}`,
			});
			throw new Error("unreachable");
		}

		if (imgWidth === 0 || imgHeight === 0) {
			buildError("badRequest", { info: "Could not read image dimensions" });
			throw new Error("unreachable");
		}

		if (!skipPanoramaCheck && imgWidth < imgHeight * MIN_PANORAMA_RATIO) {
			buildError("badRequest", {
				info: `Image must be a panorama (width must be at least ${MIN_PANORAMA_RATIO}x height)`,
			});
			throw new Error("unreachable");
		}

		if (imgWidth * imgHeight > MAX_PIXEL_COUNT) {
			buildError("badRequest", {
				info: `Image too large: ${imgWidth}x${imgHeight} exceeds maximum of ${MAX_PIXEL_COUNT} pixels`,
			});
			throw new Error("unreachable");
		}

		const sizes = REQUIRED_SIZES[displayType];
		if (!sizes?.length) {
			buildError("badRequest", {
				info: `Unknown display type: ${displayType}`,
			});
			throw new Error("unreachable");
		}

		return sizes;
	}

	static async splitPreview(
		displayType: string,
		file: File,
		parts: number,
		targetWidth?: number,
		targetHeight?: number,
	) {
		const rawBuffer = Buffer.from(await file.arrayBuffer());
		const meta = await sharp(rawBuffer).metadata();
		const originalWidth = meta.width ?? 0;
		const originalHeight = meta.height ?? 0;

		const sizes = PublishingService.validateSplitParams(
			displayType,
			originalWidth,
			originalHeight,
			parts,
		);

		// Available portrait sizes for user selection
		const portraitSizes = sizes.filter(([w, h]) => h >= w);
		const availableSizes = (
			portraitSizes.length > 0 ? portraitSizes : sizes
		).map(([w, h]) => ({ height: h, width: w }));

		// Use user-chosen size or default to first portrait size
		if (!targetWidth || !targetHeight) {
			const defaultSize = availableSizes[0];
			targetWidth = defaultSize.width;
			targetHeight = defaultSize.height;
		}

		const partWidth = Math.floor(originalWidth / parts);
		const partHeight = originalHeight;

		// Auto-detect suggested parts based on target aspect ratio
		const targetAspect = targetWidth / targetHeight;
		const suggestedParts = Math.max(
			MIN_SPLIT_PARTS,
			Math.min(
				MAX_SPLIT_PARTS,
				Math.round(originalWidth / (originalHeight * targetAspect)),
			),
		);

		// Generate preview with split lines overlay using sharp composite
		const svgLines = Array.from({ length: parts - 1 }, (_, i) => {
			const x = Math.round((i + 1) * partWidth);
			return `<line x1="${x}" y1="0" x2="${x}" y2="${originalHeight}" stroke="white" stroke-width="4" stroke-dasharray="20,10" />`;
		}).join("");

		const svgOverlay = Buffer.from(
			`<svg width="${originalWidth}" height="${originalHeight}">${svgLines}</svg>`,
		);

		// Composite SVG onto original, then resize for smaller output
		const composited = await sharp(rawBuffer)
			.composite([{ input: svgOverlay, left: 0, top: 0 }])
			.toBuffer();

		const previewBuffer = await sharp(composited)
			.resize(Math.min(originalWidth, 2000))
			.png({ compressionLevel: 8 })
			.toBuffer();

		const previewUrl = `data:image/png;base64,${previewBuffer.toString("base64")}`;

		return {
			availableSizes,
			originalHeight,
			originalWidth,
			partHeight,
			parts,
			partWidth,
			previewUrl,
			suggestedParts,
			targetHeight,
			targetWidth,
		};
	}

	static async splitUpload(
		appId: string,
		versionId: string,
		language: string,
		displayType: string,
		file: File,
		parts: number,
		insertAt?: number,
		targetWidth?: number,
		targetHeight?: number,
		cropParams?: { x: number; y: number; width: number; height: number },
	) {
		let rawBuffer = Buffer.from(await file.arrayBuffer());

		// If crop params provided, extract the crop region first
		if (cropParams) {
			rawBuffer = await sharp(rawBuffer)
				.extract({
					height: Math.round(cropParams.height),
					left: Math.round(cropParams.x),
					top: Math.round(cropParams.y),
					width: Math.round(cropParams.width),
				})
				.toBuffer();
		}

		const meta = await sharp(rawBuffer).metadata();
		const imgWidth = meta.width ?? 0;
		const imgHeight = meta.height ?? 0;

		PublishingService.validateSplitParams(
			displayType,
			imgWidth,
			imgHeight,
			parts,
			!!cropParams,
		);

		// Check existing screenshot count
		const app = await PublishingService.getAppWithStore(appId);
		if (app.store.type !== "app_store" || !app.store.credentials) {
			buildError("badRequest", {
				info: "Screenshots are only available for App Store apps",
			});
			throw new Error("unreachable");
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		const client = await createAppStoreClient(credentials);

		// Find localization
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

		// Find or create screenshot set
		const { data: sets } = await client.readAll(
			`appStoreVersionLocalizations/${loc.id}/appScreenshotSets`,
		);
		let screenshotSet = ((sets ?? []) as ApiResource[]).find(
			(s) => s.attributes.screenshotDisplayType === displayType,
		);

		if (!screenshotSet) {
			screenshotSet = (await client.create({
				attributes: { screenshotDisplayType: displayType },
				relationships: {
					appStoreVersionLocalization: loc,
				},
				type: "appScreenshotSets",
			})) as unknown as ApiResource;
		}

		// Check existing count
		const { data: existingScreenshots } = await client.readAll(
			`appScreenshotSets/${screenshotSet.id}/appScreenshots`,
		);
		const existingCount = ((existingScreenshots ?? []) as ApiResource[]).length;

		if (existingCount + parts > MAX_SCREENSHOTS_PER_SET) {
			buildError("badRequest", {
				info: `Cannot add ${parts} screenshots: ${existingCount} already exist, maximum is ${MAX_SCREENSHOTS_PER_SET}`,
			});
			throw new Error("unreachable");
		}

		// Validate insertAt bounds
		if (insertAt !== undefined && (insertAt < 0 || insertAt > existingCount)) {
			buildError("badRequest", {
				info: `insertAt must be between 0 and ${existingCount}`,
			});
			throw new Error("unreachable");
		}

		// Split and upload each part
		const partWidth = Math.floor(imgWidth / parts);
		const screenshotIds: string[] = [];

		for (let i = 0; i < parts; i++) {
			const left = i * partWidth;
			// Last part takes remaining width to avoid rounding gaps
			const width = i === parts - 1 ? imgWidth - left : partWidth;

			const partBuffer = await sharp(rawBuffer)
				.extract({ height: imgHeight, left, top: 0, width })
				.toBuffer();

			const targetOverride =
				targetWidth && targetHeight
					? ([targetWidth, targetHeight] as [number, number])
					: undefined;
			const processed = await processScreenshot(
				partBuffer,
				displayType,
				undefined,
				targetOverride,
			);

			const pngName = file.name.replace(/\.\w+$/, `_part${i + 1}.png`);

			const screenshot = (await client.create({
				attributes: {
					fileName: pngName,
					fileSize: processed.buffer.length,
				},
				relationships: {
					appScreenshotSet: screenshotSet,
				},
				type: "appScreenshots",
			})) as unknown as ApiResource;

			await client.uploadAsset(screenshot, processed.buffer);
			await client.pollForUploadSuccess(
				`appScreenshots/${screenshot.id}`,
				"screenshot",
			);

			screenshotIds.push(screenshot.id);
		}

		// If insertAt is specified, reorder to place new screenshots at the right position
		if (insertAt !== undefined && existingCount > 0) {
			const existingIds = ((existingScreenshots ?? []) as ApiResource[]).map(
				(s) => s.id,
			);
			const finalOrder = [
				...existingIds.slice(0, insertAt),
				...screenshotIds,
				...existingIds.slice(insertAt),
			];

			const url = `appScreenshotSets/${screenshotSet.id}/relationships/appScreenshots`;
			await client.postJson(
				url,
				{ data: finalOrder.map((id) => ({ id, type: "appScreenshots" })) },
				{ method: "PATCH" },
			);
		}

		log.info(
			{
				appId,
				displayType,
				language,
				parts,
				screenshotIds,
			},
			"Split-uploaded panorama screenshots",
		);

		return { screenshotIds, uploaded: parts };
	}

	static async copyScreenshots(
		appId: string,
		versionId: string,
		sourceLanguage: string,
		targetLanguage: string,
		displayType?: string,
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

		// Get localizations
		const { data: versionLocs } = await client.readAll(
			`appStoreVersions/${versionId}/appStoreVersionLocalizations`,
		);
		const allLocs = (versionLocs ?? []) as ApiResource[];

		const sourceLoc = allLocs.find(
			(l) => l.attributes.locale === sourceLanguage,
		);
		const targetLoc = allLocs.find(
			(l) => l.attributes.locale === targetLanguage,
		);

		if (!sourceLoc) {
			buildError("notFound", {
				info: `Source language "${sourceLanguage}" not found`,
			});
			throw new Error("unreachable");
		}
		if (!targetLoc) {
			buildError("notFound", {
				info: `Target language "${targetLanguage}" not found`,
			});
			throw new Error("unreachable");
		}

		// Get source screenshot sets
		const { data: sourceSets } = await client.readAll(
			`appStoreVersionLocalizations/${sourceLoc.id}/appScreenshotSets`,
		);
		const allSourceSets = (sourceSets ?? []) as ApiResource[];

		// Filter by displayType if specified
		const setsToProcess = displayType
			? allSourceSets.filter(
					(s) => s.attributes.screenshotDisplayType === displayType,
				)
			: allSourceSets;

		if (setsToProcess.length === 0) {
			buildError("badRequest", {
				info: `No screenshots found for source language "${sourceLanguage}"`,
			});
			throw new Error("unreachable");
		}

		// Check target doesn't already have screenshots for the same display types
		const { data: targetSets } = await client.readAll(
			`appStoreVersionLocalizations/${targetLoc.id}/appScreenshotSets`,
		);
		const targetDisplayTypes = new Set(
			((targetSets ?? []) as ApiResource[]).map(
				(s) => s.attributes.screenshotDisplayType as string,
			),
		);

		let copied = 0;

		for (const sourceSet of setsToProcess) {
			const dt = sourceSet.attributes.screenshotDisplayType as string;

			// Get source screenshots
			const { data: sourceScreenshots } = await client.readAll(
				`appScreenshotSets/${sourceSet.id}/appScreenshots`,
			);
			const screenshots = (sourceScreenshots ?? []) as ApiResource[];

			if (screenshots.length === 0) continue;

			// Find or create target screenshot set
			let targetSet: ApiResource;
			if (targetDisplayTypes.has(dt)) {
				const existing = ((targetSets ?? []) as ApiResource[]).find(
					(s) => s.attributes.screenshotDisplayType === dt,
				);
				if (!existing) continue;

				// Check if target set already has screenshots
				const { data: existingTargetScreenshots } = await client.readAll(
					`appScreenshotSets/${existing.id}/appScreenshots`,
				);
				if (((existingTargetScreenshots ?? []) as ApiResource[]).length > 0) {
					log.warn(
						{ appId, displayType: dt, targetLanguage },
						"Target already has screenshots for this display type, skipping",
					);
					continue;
				}
				targetSet = existing;
			} else {
				targetSet = (await client.create({
					attributes: { screenshotDisplayType: dt },
					relationships: {
						appStoreVersionLocalization: targetLoc,
					},
					type: "appScreenshotSets",
				})) as unknown as ApiResource;
			}

			// Copy each screenshot: download from URL → re-upload
			for (const screenshot of screenshots) {
				const attrs = screenshot.attributes;
				const imageAsset = attrs.imageAsset as
					| Record<string, unknown>
					| undefined;

				if (!imageAsset?.templateUrl) continue;

				const url = (imageAsset.templateUrl as string)
					.replace("{w}", String(imageAsset.width ?? 0))
					.replace("{h}", String(imageAsset.height ?? 0))
					.replace("{f}", "png");

				// Validate URL scheme to prevent SSRF
				let parsedUrl: URL;
				try {
					parsedUrl = new URL(url);
				} catch {
					log.warn(
						{ screenshotId: screenshot.id, url },
						"Invalid screenshot URL, skipping",
					);
					continue;
				}
				if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
					log.warn(
						{
							protocol: parsedUrl.protocol,
							screenshotId: screenshot.id,
						},
						"Blocked non-HTTP(S) screenshot URL, skipping",
					);
					continue;
				}

				// Download the screenshot image with timeout and size limit
				let response: Response;
				try {
					response = await fetch(url, {
						signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
					});
				} catch (err) {
					log.warn(
						{
							error: err instanceof Error ? err.message : String(err),
							screenshotId: screenshot.id,
							url,
						},
						"Failed to fetch source screenshot (timeout or network error), skipping",
					);
					continue;
				}
				if (!response.ok) {
					log.warn(
						{ screenshotId: screenshot.id, status: response.status, url },
						"Failed to download source screenshot, skipping",
					);
					continue;
				}

				const contentLength = Number(
					response.headers.get("content-length") ?? 0,
				);
				if (contentLength > MAX_DOWNLOAD_SIZE) {
					log.warn(
						{
							contentLength,
							maxSize: MAX_DOWNLOAD_SIZE,
							screenshotId: screenshot.id,
						},
						"Source screenshot exceeds size limit, skipping",
					);
					continue;
				}

				const imageBuffer = Buffer.from(await response.arrayBuffer());
				if (imageBuffer.length > MAX_DOWNLOAD_SIZE) {
					log.warn(
						{
							actualSize: imageBuffer.length,
							maxSize: MAX_DOWNLOAD_SIZE,
							screenshotId: screenshot.id,
						},
						"Downloaded screenshot exceeds size limit, skipping",
					);
					continue;
				}
				const fileName = (attrs.fileName as string) ?? "screenshot.png";

				// Create and upload to target
				const newScreenshot = (await client.create({
					attributes: {
						fileName,
						fileSize: imageBuffer.length,
					},
					relationships: {
						appScreenshotSet: targetSet,
					},
					type: "appScreenshots",
				})) as unknown as ApiResource;

				await client.uploadAsset(newScreenshot, imageBuffer);
				await client.pollForUploadSuccess(
					`appScreenshots/${newScreenshot.id}`,
					"screenshot",
				);

				copied++;
			}
		}

		log.info(
			{ appId, copied, sourceLanguage, targetLanguage },
			"Copied screenshots between languages",
		);

		return { copied };
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

		// Use cached version data
		const cachedVersions = await db
			.select()
			.from(appVersions)
			.where(eq(appVersions.appId, appId));

		if (cachedVersions.length > 0) {
			const latest = cachedVersions[0];
			return {
				isEditable: latest.isEditable,
				state: latest.state,
				versionString: latest.versionString,
			};
		}

		// No cached data — try syncing
		await PublishingService.syncVersions(appId);

		const [synced] = await db
			.select()
			.from(appVersions)
			.where(eq(appVersions.appId, appId))
			.limit(1);

		if (!synced) return null;

		return {
			isEditable: synced.isEditable,
			state: synced.state,
			versionString: synced.versionString,
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

		// Auto-copy languages from the previous version
		const copiedLanguages: string[] = [];

		if (result.versionId) {
			const previousVersions = await db
				.select()
				.from(appVersions)
				.where(eq(appVersions.appId, appId))
				.orderBy(desc(appVersions.createdAt))
				.limit(1);

			if (previousVersions.length > 0) {
				const prevLocs = await db
					.select({ language: versionLocalizations.language })
					.from(versionLocalizations)
					.where(
						and(
							eq(versionLocalizations.versionId, previousVersions[0].id),
							eq(versionLocalizations.source, "remote"),
						),
					);

				if (credentials.keyId) {
					// Real ASC credentials — create localizations on ASC
					const client = await createAppStoreClient(credentials);

					for (const loc of prevLocs) {
						try {
							await client.create({
								attributes: { locale: loc.language },
								relationships: {
									appStoreVersion: {
										id: result.versionId,
										type: "appStoreVersions",
									},
								},
								type: "appStoreVersionLocalizations",
							});
							copiedLanguages.push(loc.language);
						} catch (err) {
							log.warn(
								{ err, locale: loc.language },
								"Failed to copy locale to new version",
							);
						}
					}
				} else {
					// Mock mode — just report which languages would be copied
					for (const loc of prevLocs) {
						copiedLanguages.push(loc.language);
					}
				}

				if (copiedLanguages.length > 0 && credentials.keyId) {
					await PublishingService.syncVersions(appId);
					log.info(
						{ appId, copiedLanguages, count: copiedLanguages.length },
						"Copied languages to new version",
					);
				}
			}
		}

		return {
			copiedLanguages,
			state: result.state,
			versionString: result.versionString,
		};
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

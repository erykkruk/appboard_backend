import { and, eq } from "drizzle-orm";
import type { ApiResource } from "node-app-store-connect-api";
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
					const state =
						(v.attributes.appStoreState as string) ?? "";
					const versionString =
						(v.attributes.versionString as string) ?? "";
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
		const versionString =
			(version.attributes.versionString as string) ?? "";

		// Fetch version localizations (description, keywords, whatsNew, promoText, etc.)
		const { data: versionLocs } = await readAll(
			`appStoreVersions/${versionId}/appStoreVersionLocalizations`,
		);

		// Also fetch appInfo localizations for title/subtitle
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

		const localizations = ((versionLocs ?? []) as ApiResource[]).map(
			(loc) => {
				const attrs = loc.attributes;
				const locale = attrs.locale as string;
				const infoLoc = infoLocByLang.get(locale);

				return {
					description: (attrs.description as string) ?? "",
					keywords: (attrs.keywords as string) ?? "",
					language: locale,
					marketingUrl: (attrs.marketingUrl as string) ?? undefined,
					promotionalText:
						(attrs.promotionalText as string) ?? undefined,
					subtitle: (infoLoc?.attributes?.subtitle as string) ?? "",
					supportUrl: (attrs.supportUrl as string) ?? undefined,
					title: (infoLoc?.attributes?.name as string) ?? "",
					whatsNew: (attrs.whatsNew as string) ?? undefined,
				};
			},
		);

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
			APP_IPHONE_35: "iPhone 3.5\"",
			APP_IPHONE_40: "iPhone 4.0\"",
			APP_IPHONE_47: "iPhone 4.7\"",
			APP_IPHONE_55: "iPhone 5.5\"",
			APP_IPHONE_58: "iPhone 5.8\"",
			APP_IPHONE_61: "iPhone 6.1\"",
			APP_IPHONE_65: "iPhone 6.5\"",
			APP_IPHONE_67: "iPhone 6.7\"",
		};

		const screenshots: {
			deviceType: string;
			displayType: string;
			height: number | null;
			language: string;
			url: string;
			width: number | null;
		}[] = [];

		for (const loc of (versionLocs as ApiResource[])) {
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
						deviceType:
							DISPLAY_TYPE_LABELS[displayType] ?? displayType,
						displayType,
						height,
						language: locale,
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

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

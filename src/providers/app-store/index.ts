import {
	getMockAssets,
	getMockListings,
	getMockReviews,
	MOCK_IOS_APPS,
} from "@/providers/mock-data";
import type {
	AppData,
	AssetData,
	AssetMetadata,
	ListingData,
	ListingUpdateData,
	ReviewData,
	StoreProvider,
} from "@/providers/store-provider";
import { createLogger } from "@/utils/logger";
import type { ApiResource } from "node-app-store-connect-api";
import { createAppStoreClient } from "./client";
import { type AppStoreCredentials, isMockCredentials } from "./types";

const log = createLogger("app-store");

const SCREENSHOT_DISPLAY_TYPE_TO_DEVICE: Record<string, string> = {
	APP_APPLE_TV: "appleTV",
	APP_DESKTOP: "desktop",
	APP_IPAD_105: "iPad10.5",
	APP_IPAD_97: "iPad9.7",
	APP_IPAD_PRO_129: "iPadPro12.9",
	APP_IPAD_PRO_3RD_GEN_129: "iPadPro12.9-3rdGen",
	APP_IPHONE_35: "iPhone3.5",
	APP_IPHONE_40: "iPhone4.0",
	APP_IPHONE_47: "iPhone4.7",
	APP_IPHONE_55: "iPhone5.5",
	APP_IPHONE_58: "iPhone5.8",
	APP_IPHONE_61: "iPhone6.1",
	APP_IPHONE_65: "iPhone6.5",
	APP_IPHONE_67: "iPhone6.7",
	APP_WATCH_SERIES_3: "watchSeries3",
	APP_WATCH_SERIES_4: "watchSeries4",
	APP_WATCH_SERIES_7: "watchSeries7",
	APP_WATCH_ULTRA: "watchUltra",
};

export class AppStoreProvider implements StoreProvider {
	private readonly isMock: boolean;

	constructor(private readonly credentials: AppStoreCredentials) {
		this.isMock = isMockCredentials(credentials);
		if (this.isMock) {
			log.info("App Store provider initialized in mock mode");
		}
	}

	async validateCredentials(): Promise<boolean> {
		if (this.isMock) return true;
		try {
			const { readAll } = await createAppStoreClient(this.credentials);
			const { data } = await readAll("apps", { params: { limit: 1 } });
			log.info({ appCount: data?.length ?? 0 }, "Credentials validated");
			return true;
		} catch (err) {
			log.error({ err }, "App Store credentials validation failed");
			return false;
		}
	}

	async fetchApps(): Promise<AppData[]> {
		if (this.isMock) return MOCK_IOS_APPS;

		const { readAll } = await createAppStoreClient(this.credentials);
		const { data: appsData } = await readAll("apps");

		const apps: AppData[] = (appsData ?? []).map((raw) => {
			return {
				bundleId: (raw.attributes.bundleId as string) ?? "",
				externalId: raw.id,
				name: (raw.attributes.name as string) ?? "",
				platform: "ios" as const,
			};
		});

		log.info({ count: apps.length }, "Fetched apps from App Store Connect");
		return apps;
	}

	async fetchListings(appId: string): Promise<ListingData[]> {
		if (this.isMock) return getMockListings(appId);

		try {
			const { readAll } = await createAppStoreClient(this.credentials);

			const { data: appInfos } = await readAll(
				`apps/${appId}/appInfos`,
			);

			if (!appInfos?.length) {
				log.warn({ appId }, "No appInfos found for app");
				return [];
			}

			const latestInfo = appInfos[0] as ApiResource;
			const { data: localizations } = await readAll(
				`appInfos/${latestInfo.id}/appInfoLocalizations`,
			);

			// Also fetch the latest app store version for whatsNew
			const { data: versions } = await readAll(
				`apps/${appId}/appStoreVersions`,
			);
			const latestVersion = versions?.[0] as ApiResource | undefined;

			let versionLocalizations: ApiResource[] = [];
			if (latestVersion) {
				const { data: versionLocs } = await readAll(
					`appStoreVersions/${latestVersion.id}/appStoreVersionLocalizations`,
				);
				versionLocalizations = (versionLocs ?? []) as ApiResource[];
			}

			const versionLocByLang = new Map<string, ApiResource>();
			for (const vl of versionLocalizations) {
				const locale = vl.attributes.locale as string;
				versionLocByLang.set(locale, vl);
			}

			const listings: ListingData[] = (
				(localizations ?? []) as ApiResource[]
			).map((loc) => {
				const attrs = loc.attributes;
				const locale = attrs.locale as string;
				const versionLoc = versionLocByLang.get(locale);

				return {
					fullDesc: (versionLoc?.attributes?.description as string) ?? "",
					keywords: (versionLoc?.attributes?.keywords as string) ?? "",
					language: locale,
					marketingUrl:
						(versionLoc?.attributes?.marketingUrl as string) ?? undefined,
					privacyUrl:
						(attrs.privacyPolicyUrl as string) ?? undefined,
					promoText:
						(versionLoc?.attributes?.promotionalText as string) ?? undefined,
					shortDesc:
						(attrs.subtitle as string) ?? "",
					supportUrl:
						(versionLoc?.attributes?.supportUrl as string) ?? undefined,
					title: (attrs.name as string) ?? "",
					whatsNew:
						(versionLoc?.attributes?.whatsNew as string) ?? undefined,
				};
			});

			log.info(
				{ appId, count: listings.length },
				"Fetched listings from App Store Connect",
			);
			return listings;
		} catch (err) {
			log.error({ appId, err }, "Failed to fetch listings from App Store Connect");
			throw err;
		}
	}

	async updateListing(
		appId: string,
		language: string,
		data: ListingUpdateData,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId, language }, "Mock: listing updated");
			return;
		}

		try {
			const { readAll, update } = await createAppStoreClient(
				this.credentials,
			);

			// Find the appInfoLocalization for the given language
			const { data: appInfos } = await readAll(
				`apps/${appId}/appInfos`,
			);

			if (!appInfos?.length) {
				throw new Error(`No appInfos found for app ${appId}`);
			}

			const latestInfo = appInfos[0] as ApiResource;
			const { data: localizations } = await readAll(
				`appInfos/${latestInfo.id}/appInfoLocalizations`,
			);

			const targetLoc = (localizations as ApiResource[])?.find(
				(loc) => loc.attributes.locale === language,
			);

			if (!targetLoc) {
				throw new Error(
					`No localization found for language ${language} in app ${appId}`,
				);
			}

			// Update appInfoLocalization (title, subtitle, privacyUrl)
			const infoAttributes: Record<string, unknown> = {};
			if (data.title !== undefined) infoAttributes.name = data.title;
			if (data.shortDesc !== undefined)
				infoAttributes.subtitle = data.shortDesc;
			if (data.privacyUrl !== undefined)
				infoAttributes.privacyPolicyUrl = data.privacyUrl;

			if (Object.keys(infoAttributes).length > 0) {
				await update(
					{
						id: targetLoc.id,
						type: "appInfoLocalizations",
					},
					{ attributes: infoAttributes },
				);
				log.info(
					{ appId, language, fields: Object.keys(infoAttributes) },
					"Updated appInfoLocalization",
				);
			}

			// Update appStoreVersionLocalization (description, keywords, whatsNew, promoText, marketingUrl, supportUrl)
			const versionAttributes: Record<string, unknown> = {};
			if (data.fullDesc !== undefined)
				versionAttributes.description = data.fullDesc;
			if (data.keywords !== undefined)
				versionAttributes.keywords = data.keywords;
			if (data.whatsNew !== undefined)
				versionAttributes.whatsNew = data.whatsNew;
			if (data.promoText !== undefined)
				versionAttributes.promotionalText = data.promoText;
			if (data.marketingUrl !== undefined)
				versionAttributes.marketingUrl = data.marketingUrl;
			if (data.supportUrl !== undefined)
				versionAttributes.supportUrl = data.supportUrl;

			if (Object.keys(versionAttributes).length > 0) {
				const { data: versions } = await readAll(
					`apps/${appId}/appStoreVersions`,
				);

				if (!versions?.length) {
					log.warn(
						{ appId },
						"No app store versions found; cannot update version-level fields",
					);
					return;
				}

				const latestVersion = versions[0] as ApiResource;
				const { data: versionLocs } = await readAll(
					`appStoreVersions/${latestVersion.id}/appStoreVersionLocalizations`,
				);

				const targetVersionLoc = (versionLocs as ApiResource[])?.find(
					(loc) => loc.attributes.locale === language,
				);

				if (!targetVersionLoc) {
					log.warn(
						{ appId, language },
						"No version localization found for language; skipping version-level fields",
					);
					return;
				}

				await update(
					{
						id: targetVersionLoc.id,
						type: "appStoreVersionLocalizations",
					},
					{ attributes: versionAttributes },
				);
				log.info(
					{ appId, language, fields: Object.keys(versionAttributes) },
					"Updated appStoreVersionLocalization",
				);
			}
		} catch (err) {
			log.error(
				{ appId, err, language },
				"Failed to update listing in App Store Connect",
			);
			throw err;
		}
	}

	async publishListings(appId: string): Promise<void> {
		if (this.isMock) {
			log.info({ appId }, "Mock: listings published");
			return;
		}

		log.warn(
			{ appId },
			"App Store listing publishing requires manual submission through App Store Connect or Xcode. " +
				"Listing changes are saved to the editable version and will be published with the next app version submission.",
		);
	}

	async fetchAssets(appId: string, language: string): Promise<AssetData[]> {
		if (this.isMock) return getMockAssets(appId, language);

		try {
			const { readAll } = await createAppStoreClient(this.credentials);

			const { data: versions } = await readAll(
				`apps/${appId}/appStoreVersions`,
			);

			if (!versions?.length) {
				log.warn({ appId }, "No app store versions found");
				return [];
			}

			const latestVersion = versions[0] as ApiResource;

			const { data: versionLocalizations } = await readAll(
				`appStoreVersions/${latestVersion.id}/appStoreVersionLocalizations`,
			);

			const targetLoc = (versionLocalizations as ApiResource[])?.find(
				(loc) => loc.attributes.locale === language,
			);

			if (!targetLoc) {
				log.warn(
					{ appId, language },
					"No version localization found for language",
				);
				return [];
			}

			const { data: screenshotSets } = await readAll(
				`appStoreVersionLocalizations/${targetLoc.id}/appScreenshotSets`,
			);

			const assets: AssetData[] = [];

			for (const set of (screenshotSets ?? []) as ApiResource[]) {
				const displayType =
					(set.attributes.screenshotDisplayType as string) ?? "unknown";
				const deviceType =
					SCREENSHOT_DISPLAY_TYPE_TO_DEVICE[displayType] ?? displayType;

				const { data: screenshots } = await readAll(
					`appScreenshotSets/${set.id}/appScreenshots`,
				);

				for (const screenshot of (screenshots ?? []) as ApiResource[]) {
					const attrs = screenshot.attributes;
					const imageAsset = attrs.imageAsset as Record<string, unknown> | undefined;
					assets.push({
						assetType: "screenshot",
						deviceType,
						externalId: screenshot.id,
						fileSize: (attrs.fileSize as number) ?? undefined,
						height: (imageAsset?.height as number) ?? undefined,
						url: (imageAsset?.templateUrl as string) ?? "",
						width: (imageAsset?.width as number) ?? undefined,
					});
				}
			}

			log.info(
				{ appId, count: assets.length, language },
				"Fetched assets from App Store Connect",
			);
			return assets;
		} catch (err) {
			log.error(
				{ appId, err, language },
				"Failed to fetch assets from App Store Connect",
			);
			throw err;
		}
	}

	async uploadAsset(
		_appId: string,
		_language: string,
		_file: Buffer,
		metadata: AssetMetadata,
	): Promise<AssetData> {
		if (this.isMock) {
			return {
				assetType: metadata.assetType,
				deviceType: metadata.deviceType,
				externalId: `mock-${Date.now()}`,
				url: "https://placehold.co/1080x1920?text=uploaded",
			};
		}

		// Full upload requires multi-step reservation + upload operations.
		// For now, return a placeholder and log a warning.
		log.warn(
			"Asset upload via API requires multi-step reservation flow; not yet fully implemented",
		);
		return {
			assetType: metadata.assetType,
			deviceType: metadata.deviceType,
			externalId: `pending-${Date.now()}`,
			url: "https://placehold.co/1080x1920?text=pending-upload",
		};
	}

	async deleteAsset(appId: string, assetId: string): Promise<void> {
		if (this.isMock) {
			log.info({ appId, assetId }, "Mock: asset deleted");
			return;
		}

		try {
			const { remove } = await createAppStoreClient(this.credentials);
			await remove({ id: assetId, type: "appScreenshots" });
			log.info(
				{ appId, assetId },
				"Deleted screenshot from App Store Connect",
			);
		} catch (err) {
			log.error(
				{ appId, assetId, err },
				"Failed to delete asset from App Store Connect",
			);
			throw err;
		}
	}

	async fetchReviews(appId: string): Promise<ReviewData[]> {
		if (this.isMock) return getMockReviews(appId, "app_store");

		try {
			const { readAll } = await createAppStoreClient(this.credentials);

			const { data: reviewsData } = await readAll(
				`apps/${appId}/customerReviews`,
			);

			const reviews: ReviewData[] = (
				(reviewsData ?? []) as ApiResource[]
			).map((raw) => {
				const attrs = raw.attributes;
				return {
					authorName: (attrs.reviewerNickname as string) ?? "Anonymous",
					body: (attrs.body as string) ?? "",
					externalId: raw.id,
					language: (attrs.territory as string) ?? undefined,
					rating: (attrs.rating as number) ?? 0,
					reviewDate: new Date(
						(attrs.createdDate as string) ?? Date.now(),
					),
					territory: (attrs.territory as string) ?? undefined,
					title: (attrs.title as string) ?? undefined,
				};
			});

			log.info(
				{ appId, count: reviews.length },
				"Fetched reviews from App Store Connect",
			);
			return reviews;
		} catch (err) {
			log.error(
				{ appId, err },
				"Failed to fetch reviews from App Store Connect",
			);
			throw err;
		}
	}

	async replyToReview(
		appId: string,
		reviewId: string,
		text: string,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId, reviewId }, "Mock: review reply sent");
			return;
		}

		try {
			const { create } = await createAppStoreClient(this.credentials);

			await create({
				attributes: { responseBody: text },
				relationships: {
					review: {
						data: { id: reviewId, type: "customerReviews" },
					},
				},
				type: "customerReviewResponses",
			});

			log.info(
				{ appId, reviewId },
				"Posted review reply to App Store Connect",
			);
		} catch (err) {
			log.error(
				{ appId, err, reviewId },
				"Failed to reply to review in App Store Connect",
			);
			throw err;
		}
	}
}

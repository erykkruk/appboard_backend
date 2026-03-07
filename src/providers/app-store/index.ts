import type { ApiResource } from "node-app-store-connect-api";
import {
	getMockAssets,
	getMockInAppPurchases,
	getMockListings,
	getMockReviews,
	getMockSubscriptionGroups,
	MOCK_IOS_APPS,
} from "@/providers/mock-data";
import type {
	AppData,
	AssetData,
	AssetMetadata,
	CategoryData,
	InAppPurchaseCreateData,
	InAppPurchaseData,
	InAppPurchaseUpdateData,
	ListingData,
	ListingUpdateData,
	PurchaseLocalizationData,
	PurchasePriceData,
	ReviewData,
	StoreProvider,
	SubscriptionCreateData,
	SubscriptionGroupData,
	SubscriptionUpdateData,
	VersionData,
} from "@/providers/store-provider";
import { createLogger } from "@/utils/logger";
import { createAppStoreClient } from "./client";
import { type AppStoreCredentials, isMockCredentials } from "./types";

const log = createLogger("app-store");

const SCREENSHOT_DISPLAY_TYPE_TO_DEVICE: Record<string, string> = {
	APP_APPLE_TV: "appleTV",
	APP_DESKTOP: "desktop",
	APP_IPAD_97: "iPad9.7",
	APP_IPAD_105: "iPad10.5",
	APP_IPAD_PRO_3RD_GEN_129: "iPadPro12.9-3rdGen",
	APP_IPAD_PRO_129: "iPadPro12.9",
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

const DEVICE_TO_SCREENSHOT_DISPLAY_TYPE: Record<string, string> =
	Object.fromEntries(
		Object.entries(SCREENSHOT_DISPLAY_TYPE_TO_DEVICE).map(([k, v]) => [v, k]),
	);

// Maps internal question keys to ASC API attribute names (string enum values)
const APPLE_QUESTION_TO_ASC_ATTRIBUTE: Record<string, string> = {
	ALCOHOL_TOBACCO_DRUG_USE: "alcoholTobaccoOrDrugUseOrReferences",
	CARTOON_FANTASY_VIOLENCE: "violenceCartoonOrFantasy",
	GAMBLING_CONTESTS: "gamblingSimulated",
	GRAPHIC_SEXUAL_CONTENT_NUDITY: "sexualContentGraphicAndNudity",
	HORROR_FEAR_THEMES: "horrorOrFearThemes",
	MATURE_SUGGESTIVE: "matureOrSuggestiveThemes",
	MEDICAL_TREATMENT_INFO: "medicalOrTreatmentInformation",
	PROFANITY_CRUDE_HUMOR: "profanityOrCrudeHumor",
	PROLONGED_GRAPHIC_SADISTIC_REALISTIC_VIOLENCE:
		"violenceRealisticProlongedGraphicOrSadistic",
	REALISTIC_VIOLENCE: "violenceRealistic",
	SEXUAL_CONTENT_NUDITY: "sexualContentOrNudity",
	SIMULATED_GAMBLING: "gamblingSimulated",
};

// Maps internal question keys to boolean ASC attributes
const APPLE_QUESTION_TO_ASC_BOOLEAN: Record<string, string> = {
	UNRESTRICTED_WEB_ACCESS: "unrestrictedWebAccess",
};

// ASC API uses INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE (with _OR_)
const INTERNAL_TO_ASC_VALUE: Record<string, string> = {
	FREQUENT_INTENSE: "FREQUENT_OR_INTENSE",
	INFREQUENT_MILD: "INFREQUENT_OR_MILD",
	NONE: "NONE",
};

const ISO_TO_ASC_DURATION: Record<string, string> = {
	P1M: "ONE_MONTH",
	P1W: "ONE_WEEK",
	P1Y: "ONE_YEAR",
	P2M: "TWO_MONTHS",
	P3M: "THREE_MONTHS",
	P6M: "SIX_MONTHS",
};

const ASC_TO_ISO_DURATION: Record<string, string> = Object.fromEntries(
	Object.entries(ISO_TO_ASC_DURATION).map(([k, v]) => [v, k]),
);

const EDITABLE_STATES = [
	"PREPARE_FOR_SUBMISSION",
	"DEVELOPER_REJECTED",
	"REJECTED",
];

function findEditableVersion(versions: ApiResource[]): ApiResource | null {
	return (
		versions.find((v) =>
			EDITABLE_STATES.includes(v.attributes.appStoreState as string),
		) ?? null
	);
}

export class AppStoreProvider implements StoreProvider {
	private readonly isMock: boolean;

	constructor(private readonly credentials: AppStoreCredentials) {
		this.isMock = isMockCredentials(credentials);
		if (this.isMock) {
			log.info("App Store provider initialized in mock mode");
		}
	}

	async createVersion(
		appId: string,
		versionString: string,
	): Promise<{ state: string; versionId?: string; versionString: string }> {
		if (this.isMock) {
			return {
				state: "PREPARE_FOR_SUBMISSION",
				versionId: `mock-version-${Date.now()}`,
				versionString,
			};
		}

		const { create } = await createAppStoreClient(this.credentials);

		const result = await create({
			attributes: { platform: "IOS", versionString },
			relationships: {
				app: { data: { id: appId, type: "apps" } },
			},
			type: "appStoreVersions",
		});

		const state =
			(result.attributes?.appStoreState as string) ?? "PREPARE_FOR_SUBMISSION";

		log.info({ appId, state, versionString }, "Created new App Store version");

		return { state, versionId: result.id, versionString };
	}

	async getLatestVersion(appId: string): Promise<VersionData | null> {
		if (this.isMock) {
			return {
				isEditable: true,
				state: "PREPARE_FOR_SUBMISSION",
				versionString: "1.0.0",
			};
		}

		const { readAll } = await createAppStoreClient(this.credentials);
		const { data: versions } = await readAll(`apps/${appId}/appStoreVersions`);

		if (!versions?.length) return null;

		const latest = versions[0] as ApiResource;
		const state = (latest.attributes.appStoreState as string) ?? "";

		return {
			isEditable: EDITABLE_STATES.includes(state),
			state,
			versionString: (latest.attributes.versionString as string) ?? "",
		};
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

		// Fetch icon URLs from iTunes Lookup API (try multiple countries)
		const countries = ["US", "PL", "GB", "DE"];
		for (const app of apps) {
			for (const country of countries) {
				if (app.iconUrl) break;
				try {
					const res = await fetch(
						`https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(app.bundleId)}&country=${country}`,
					);
					const json = (await res.json()) as {
						results?: { artworkUrl512?: string }[];
					};
					if (json.results?.[0]?.artworkUrl512) {
						app.iconUrl = json.results[0].artworkUrl512;
					}
				} catch (err) {
					log.warn(
						{ bundleId: app.bundleId, err },
						"Failed to fetch icon from iTunes",
					);
				}
			}
		}

		log.info({ count: apps.length }, "Fetched apps from App Store Connect");
		return apps;
	}

	async fetchListings(appId: string): Promise<ListingData[]> {
		if (this.isMock) return getMockListings(appId);

		try {
			const { readAll } = await createAppStoreClient(this.credentials);

			const { data: appInfos } = await readAll(`apps/${appId}/appInfos`);

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
					privacyUrl: (attrs.privacyPolicyUrl as string) ?? undefined,
					promoText:
						(versionLoc?.attributes?.promotionalText as string) ?? undefined,
					shortDesc: (attrs.subtitle as string) ?? "",
					supportUrl:
						(versionLoc?.attributes?.supportUrl as string) ?? undefined,
					title: (attrs.name as string) ?? "",
					whatsNew: (versionLoc?.attributes?.whatsNew as string) ?? undefined,
				};
			});

			log.info(
				{ appId, count: listings.length },
				"Fetched listings from App Store Connect",
			);
			return listings;
		} catch (err) {
			log.error(
				{ appId, err },
				"Failed to fetch listings from App Store Connect",
			);
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
			const { readAll, update } = await createAppStoreClient(this.credentials);

			// Find the appInfoLocalization for the given language
			const { data: appInfos } = await readAll(`apps/${appId}/appInfos`);

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
				try {
					await update(
						{
							id: targetLoc.id,
							type: "appInfoLocalizations",
						},
						{ attributes: infoAttributes },
					);
					log.info(
						{ appId, fields: Object.keys(infoAttributes), language },
						"Updated appInfoLocalization",
					);
				} catch (_infoErr) {
					log.warn(
						{ appId, fields: Object.keys(infoAttributes), language },
						"Could not update appInfoLocalization (name/subtitle/privacyUrl) - app may not have an editable version. Continuing with version-level fields.",
					);
				}
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
				const editableVersion = await this.getEditableVersion(appId);

				if (!editableVersion) {
					log.warn(
						{ appId },
						"No editable app store version found; cannot update version-level fields. Create a new version first.",
					);
					return;
				}

				const { data: versionLocs } = await readAll(
					`appStoreVersions/${editableVersion.id}/appStoreVersionLocalizations`,
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

				try {
					await update(
						{
							id: targetVersionLoc.id,
							type: "appStoreVersionLocalizations",
						},
						{ attributes: versionAttributes },
					);
					log.info(
						{ appId, fields: Object.keys(versionAttributes), language },
						"Updated appStoreVersionLocalization",
					);
				} catch (_versionErr) {
					log.warn(
						{ appId, fields: Object.keys(versionAttributes), language },
						"Could not update appStoreVersionLocalization - version may not be editable.",
					);
				}
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
					const imageAsset = attrs.imageAsset as
						| Record<string, unknown>
						| undefined;
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
		appId: string,
		language: string,
		file: Buffer,
		metadata: AssetMetadata & { fileName?: string },
	): Promise<AssetData> {
		if (this.isMock) {
			return {
				assetType: metadata.assetType,
				deviceType: metadata.deviceType,
				externalId: `mock-${Date.now()}`,
				url: "https://placehold.co/1080x1920?text=uploaded",
			};
		}

		try {
			const { create, readAll, uploadAsset, pollForUploadSuccess } =
				await createAppStoreClient(this.credentials);

			// Get an editable version (must be in PREPARE_FOR_SUBMISSION or similar state)
			const editableVersion = await this.getEditableVersion(appId);
			if (!editableVersion) {
				throw new Error(
					`No editable app store version found for app ${appId}. Create a new version first.`,
				);
			}
			const latestVersion = editableVersion;

			// Find localization for the language
			const { data: versionLocalizations } = await readAll(
				`appStoreVersions/${latestVersion.id}/appStoreVersionLocalizations`,
			);
			const targetLoc = (versionLocalizations as ApiResource[])?.find(
				(loc) => loc.attributes.locale === language,
			);
			if (!targetLoc) {
				throw new Error(
					`No version localization found for language ${language}`,
				);
			}

			// Reverse lookup: device type → screenshot display type
			const displayType =
				DEVICE_TO_SCREENSHOT_DISPLAY_TYPE[metadata.deviceType];
			if (!displayType) {
				throw new Error(
					`Unknown device type: ${metadata.deviceType}. Cannot map to screenshot display type.`,
				);
			}

			// Find or create the screenshot set for this device type
			const { data: screenshotSets } = await readAll(
				`appStoreVersionLocalizations/${targetLoc.id}/appScreenshotSets`,
			);
			let screenshotSet = (screenshotSets as ApiResource[])?.find(
				(set) => set.attributes.screenshotDisplayType === displayType,
			);

			if (!screenshotSet) {
				const created = await create({
					attributes: { screenshotDisplayType: displayType },
					relationships: {
						appStoreVersionLocalization: targetLoc,
					},
					type: "appScreenshotSets",
				});
				screenshotSet = created.data;
			}

			// Reserve a screenshot slot
			const fileName = metadata.fileName ?? "screenshot.png";
			const reservation = await create({
				attributes: { fileName, fileSize: file.length },
				relationships: {
					appScreenshotSet: screenshotSet,
				},
				type: "appScreenshots",
			});

			// Upload the file binary
			await uploadAsset(reservation, file);

			// Poll until the upload is processed
			const selfUrl =
				reservation.data.links?.self ?? `appScreenshots/${reservation.data.id}`;
			await pollForUploadSuccess(selfUrl);

			const screenshotId = reservation.data.id;
			const imageAsset = reservation.data.attributes?.imageAsset as
				| Record<string, unknown>
				| undefined;

			log.info(
				{ appId, language, screenshotId },
				"Screenshot uploaded to App Store Connect",
			);

			return {
				assetType: "screenshot",
				deviceType: metadata.deviceType,
				externalId: screenshotId,
				fileSize: file.length,
				height: (imageAsset?.height as number) ?? undefined,
				url: (imageAsset?.templateUrl as string) ?? "",
				width: (imageAsset?.width as number) ?? undefined,
			};
		} catch (err) {
			log.error(
				{ appId, err, language },
				"Failed to upload asset to App Store Connect",
			);
			throw err;
		}
	}

	async deleteAsset(appId: string, assetId: string): Promise<void> {
		if (this.isMock) {
			log.info({ appId, assetId }, "Mock: asset deleted");
			return;
		}

		try {
			const { remove } = await createAppStoreClient(this.credentials);
			await remove({ id: assetId, type: "appScreenshots" });
			log.info({ appId, assetId }, "Deleted screenshot from App Store Connect");
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
			const { read, readAll } = await createAppStoreClient(this.credentials);

			const { data: reviewsData } = await readAll(
				`apps/${appId}/customerReviews`,
			);

			const reviews: ReviewData[] = [];
			for (const raw of (reviewsData ?? []) as ApiResource[]) {
				const attrs = raw.attributes;

				// Fetch the developer response for this review
				let replyText: string | undefined;
				let repliedAt: Date | undefined;
				try {
					const { data: responseData } = await read(
						`customerReviews/${raw.id}/response`,
					);
					const response = responseData as ApiResource | undefined;
					if (response?.attributes?.responseBody) {
						replyText = response.attributes.responseBody as string;
						repliedAt = response.attributes.lastModifiedDate
							? new Date(response.attributes.lastModifiedDate as string)
							: undefined;
					}
				} catch {
					// Response endpoint may 404 if no response exists
				}

				reviews.push({
					authorName: (attrs.reviewerNickname as string) ?? "Anonymous",
					body: (attrs.body as string) ?? "",
					externalId: raw.id,
					language: (attrs.territory as string) ?? undefined,
					rating: (attrs.rating as number) ?? 0,
					repliedAt,
					replyText,
					reviewDate: new Date((attrs.createdDate as string) ?? Date.now()),
					territory: (attrs.territory as string) ?? undefined,
					title: (attrs.title as string) ?? undefined,
				});
			}

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

			log.info({ appId, reviewId }, "Posted review reply to App Store Connect");
		} catch (err) {
			log.error(
				{ appId, err, reviewId },
				"Failed to reply to review in App Store Connect",
			);
			throw err;
		}
	}

	async updateAgeRating(
		appId: string,
		appleQuestionnaire: Record<string, string>,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId }, "Mock: age rating updated");
			return;
		}

		try {
			const { read, readAll, update } = await createAppStoreClient(
				this.credentials,
			);

			// Get the editable appInfo (age rating is tied to appInfo, not version)
			const { data: appInfos } = await readAll(`apps/${appId}/appInfos`);
			if (!appInfos?.length) {
				throw new Error(`No appInfos found for app ${appId}`);
			}

			// Find an editable appInfo first, fall back to the first one
			const editableInfo = findEditableVersion(appInfos as ApiResource[]);
			const latestInfo = editableInfo ?? (appInfos[0] as ApiResource);

			if (!editableInfo) {
				log.warn(
					{ appId },
					"No editable appInfo found — age rating may not be updatable. Create a new version first.",
				);
			}

			// Read the ageRatingDeclaration linked to this appInfo
			const { data: declarations } = await read(
				`appInfos/${latestInfo.id}/ageRatingDeclaration`,
			);
			const declaration = (
				Array.isArray(declarations) ? declarations[0] : declarations
			) as ApiResource | undefined;

			if (!declaration) {
				throw new Error(`No age rating declaration found for app ${appId}`);
			}

			// Map internal keys to ASC API attributes with correct types/values
			const ascAttributes: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(appleQuestionnaire)) {
				// Check if this is a boolean attribute
				const boolKey = APPLE_QUESTION_TO_ASC_BOOLEAN[key];
				if (boolKey) {
					ascAttributes[boolKey] = value !== "NONE";
					continue;
				}

				// String enum attribute
				const ascKey = APPLE_QUESTION_TO_ASC_ATTRIBUTE[key];
				if (ascKey) {
					ascAttributes[ascKey] = INTERNAL_TO_ASC_VALUE[value] ?? value;
				}
			}

			await update(
				{ id: declaration.id, type: "ageRatingDeclarations" },
				{ attributes: ascAttributes },
			);

			log.info(
				{ appId, fields: Object.keys(ascAttributes) },
				"Updated age rating declaration on App Store Connect",
			);
		} catch (err) {
			log.error(
				{ appId, err },
				"Failed to update age rating on App Store Connect",
			);
			throw err;
		}
	}

	async fetchCategories(appId: string): Promise<CategoryData> {
		if (this.isMock) {
			return { primaryCategory: "UTILITIES", secondaryCategory: null };
		}

		try {
			const { readAll } = await createAppStoreClient(this.credentials);
			const { data: appInfos } = await readAll(`apps/${appId}/appInfos`);

			if (!appInfos?.length) {
				return { primaryCategory: null, secondaryCategory: null };
			}

			const latestInfo = appInfos[0] as ApiResource;
			const primaryRel = latestInfo.relationships?.primaryCategory?.data as
				| { id: string }
				| undefined;
			const secondaryRel = latestInfo.relationships?.secondaryCategory?.data as
				| { id: string }
				| undefined;

			log.info(
				{
					appId,
					primary: primaryRel?.id ?? null,
					secondary: secondaryRel?.id ?? null,
				},
				"Fetched categories from App Store Connect",
			);

			return {
				primaryCategory: primaryRel?.id ?? null,
				secondaryCategory: secondaryRel?.id ?? null,
			};
		} catch (err) {
			log.error(
				{ appId, err },
				"Failed to fetch categories from App Store Connect",
			);
			return { primaryCategory: null, secondaryCategory: null };
		}
	}

	async updateCategories(
		appId: string,
		primaryCategory: string,
		secondaryCategory?: string,
	): Promise<void> {
		if (this.isMock) {
			log.info(
				{ appId, primaryCategory, secondaryCategory },
				"Mock: categories updated",
			);
			return;
		}

		try {
			const { readAll, update } = await createAppStoreClient(this.credentials);
			const { data: appInfos } = await readAll(`apps/${appId}/appInfos`);

			if (!appInfos?.length) {
				throw new Error(`No appInfos found for app ${appId}`);
			}

			const editableInfo = findEditableVersion(appInfos as ApiResource[]);
			const targetInfo = editableInfo ?? (appInfos[0] as ApiResource);

			const relationships: Record<string, unknown> = {
				primaryCategory: {
					data: { id: primaryCategory, type: "appCategories" },
				},
			};

			if (secondaryCategory) {
				relationships.secondaryCategory = {
					data: { id: secondaryCategory, type: "appCategories" },
				};
			} else {
				relationships.secondaryCategory = { data: null };
			}

			await update({ id: targetInfo.id, type: "appInfos" }, { relationships });

			log.info(
				{ appId, primaryCategory, secondaryCategory },
				"Updated categories on App Store Connect",
			);
		} catch (err) {
			log.error(
				{ appId, err },
				"Failed to update categories on App Store Connect",
			);
			throw err;
		}
	}

	async updatePrivacyDeclaration(
		_appId: string,
		_data: import("../store-provider").PrivacyDeclarationData,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId: _appId }, "Mock: privacy declaration updated");
			return;
		}

		// TODO: Implement App Store Connect privacy declaration push
		// App Privacy uses the App Store Connect API appPrivacyDetails endpoints
		log.warn(
			{ appId: _appId },
			"App Store privacy declaration push not yet implemented",
		);
	}

	async fetchInAppPurchases(appId: string): Promise<InAppPurchaseData[]> {
		if (this.isMock) return getMockInAppPurchases(appId);

		try {
			const { readAll } = await createAppStoreClient(this.credentials);

			const { data: iapsData } = await readAll(
				`apps/${appId}/inAppPurchasesV2`,
			);

			const purchases: InAppPurchaseData[] = [];

			for (const raw of (iapsData ?? []) as ApiResource[]) {
				const attrs = raw.attributes;
				const productType = this.mapIapType(attrs.inAppPurchaseType as string);

				// Fetch localizations
				let localizations: PurchaseLocalizationData[] = [];
				try {
					const { data: locs } = await readAll(
						`v2/inAppPurchases/${raw.id}/inAppPurchaseLocalizations`,
					);
					localizations = ((locs ?? []) as ApiResource[]).map((loc) => ({
						description: (loc.attributes.description as string) ?? undefined,
						externalId: loc.id,
						language: (loc.attributes.locale as string) ?? "en-US",
						name: (loc.attributes.name as string) ?? undefined,
					}));
				} catch {
					log.debug({ iapId: raw.id }, "Could not fetch IAP localizations");
				}

				// Fetch price schedule
				let prices: PurchasePriceData[] = [];
				try {
					const { data: priceSchedule } = await readAll(
						`v2/inAppPurchases/${raw.id}/iapPriceSchedule`,
					);
					if (priceSchedule) {
						const schedule = (
							Array.isArray(priceSchedule) ? priceSchedule[0] : priceSchedule
						) as ApiResource | undefined;
						if (schedule) {
							const { data: manualPrices } = await readAll(
								`inAppPurchasePriceSchedules/${schedule.id}/manualPrices`,
							);
							prices = ((manualPrices ?? []) as ApiResource[]).map((p) => ({
								currency: "USD",
								externalId: p.id,
								price:
									(
										p.relationships?.inAppPurchasePricePoint?.data as
											| { id: string }
											| undefined
									)?.id ?? "0",
								territory:
									(
										p.relationships?.territory?.data as
											| { id: string }
											| undefined
									)?.id ?? "US",
							}));
						}
					}
				} catch {
					log.debug({ iapId: raw.id }, "Could not fetch IAP prices");
				}

				purchases.push({
					externalId: raw.id,
					localizations,
					name:
						(attrs.name as string) ??
						localizations[0]?.name ??
						(attrs.productId as string) ??
						"",
					prices,
					productId: (attrs.productId as string) ?? "",
					productType,
					status: this.mapIapState(attrs.state as string),
				});
			}

			log.info(
				{ appId, count: purchases.length },
				"Fetched in-app purchases from App Store Connect",
			);
			return purchases;
		} catch (err) {
			log.error({ appId, err }, "Failed to fetch in-app purchases from ASC");
			return [];
		}
	}

	async fetchSubscriptionGroups(
		appId: string,
	): Promise<SubscriptionGroupData[]> {
		if (this.isMock) return getMockSubscriptionGroups(appId);

		try {
			const { readAll } = await createAppStoreClient(this.credentials);

			const { data: groupsData } = await readAll(
				`apps/${appId}/subscriptionGroups`,
			);

			const groups: SubscriptionGroupData[] = [];

			for (const raw of (groupsData ?? []) as ApiResource[]) {
				const { data: subsData } = await readAll(
					`subscriptionGroups/${raw.id}/subscriptions`,
				);

				const subscriptions: InAppPurchaseData[] = [];

				for (const sub of (subsData ?? []) as ApiResource[]) {
					const attrs = sub.attributes;

					// Fetch localizations
					let localizations: PurchaseLocalizationData[] = [];
					try {
						const { data: locs } = await readAll(
							`subscriptions/${sub.id}/subscriptionLocalizations`,
						);
						localizations = ((locs ?? []) as ApiResource[]).map((loc) => ({
							description: (loc.attributes.description as string) ?? undefined,
							externalId: loc.id,
							language: (loc.attributes.locale as string) ?? "en-US",
							name: (loc.attributes.name as string) ?? undefined,
						}));
					} catch {
						log.debug(
							{ subId: sub.id },
							"Could not fetch subscription localizations",
						);
					}

					const rawDuration = (attrs.subscriptionPeriod as string) ?? undefined;
					subscriptions.push({
						duration: rawDuration
							? (ASC_TO_ISO_DURATION[rawDuration] ?? rawDuration)
							: undefined,
						externalId: sub.id,
						groupExternalId: raw.id,
						localizations,
						name: (attrs.name as string) ?? localizations[0]?.name ?? "",
						productId: (attrs.productId as string) ?? "",
						productType: "auto_renewable",
						status: this.mapSubState(attrs.state as string),
					});
				}

				groups.push({
					externalId: raw.id,
					name:
						(raw.attributes.referenceName as string) ?? "Subscription Group",
					subscriptions,
				});
			}

			log.info(
				{ appId, groupCount: groups.length },
				"Fetched subscription groups from App Store Connect",
			);
			return groups;
		} catch (err) {
			log.error({ appId, err }, "Failed to fetch subscription groups from ASC");
			return [];
		}
	}

	async createInAppPurchase(
		appId: string,
		data: InAppPurchaseCreateData,
	): Promise<InAppPurchaseData> {
		if (this.isMock) {
			log.info({ appId, productId: data.productId }, "Mock: IAP created");
			return {
				externalId: `mock-iap-${Date.now()}`,
				localizations: data.localizations ?? [],
				name: data.name,
				prices: data.prices ?? [],
				productId: data.productId,
				productType: data.productType,
				status: "draft",
			};
		}

		const { create } = await createAppStoreClient(this.credentials);

		const ascType = this.mapProductTypeToAsc(data.productType);

		const result = await create({
			attributes: {
				inAppPurchaseType: ascType,
				name: data.name,
				productId: data.productId,
				reviewNote: "",
			},
			relationships: {
				app: { data: { id: appId, type: "apps" } },
			},
			type: "inAppPurchases",
			version: 2,
		});

		const iapId = result.id;

		// Create localizations
		for (const loc of data.localizations ?? []) {
			await create({
				attributes: {
					description: loc.description ?? "",
					locale: loc.language,
					name: loc.name ?? data.name,
				},
				relationships: {
					inAppPurchaseV2: { data: { id: iapId, type: "inAppPurchases" } },
				},
				type: "inAppPurchaseLocalizations",
			});
		}

		log.info({ appId, iapId, productId: data.productId }, "IAP created on ASC");

		return {
			externalId: iapId,
			localizations: data.localizations ?? [],
			name: data.name,
			prices: data.prices ?? [],
			productId: data.productId,
			productType: data.productType,
			status: "draft",
		};
	}

	async updateInAppPurchase(
		appId: string,
		externalId: string,
		data: InAppPurchaseUpdateData,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId, externalId }, "Mock: IAP updated");
			return;
		}

		const { readAll, update } = await createAppStoreClient(this.credentials);

		if (data.name) {
			await update(
				{ id: externalId, type: "inAppPurchases" },
				{ attributes: { name: data.name }, version: 2 },
			);
		}

		// Update localizations
		if (data.localizations?.length) {
			const { data: existingLocs } = await readAll(
				`v2/inAppPurchases/${externalId}/inAppPurchaseLocalizations`,
			);

			for (const loc of data.localizations) {
				const existing = (existingLocs as ApiResource[])?.find(
					(l) => l.attributes.locale === loc.language,
				);

				if (existing) {
					await update(
						{ id: existing.id, type: "inAppPurchaseLocalizations" },
						{
							attributes: {
								description: loc.description ?? "",
								name: loc.name ?? "",
							},
						},
					);
				}
			}
		}

		log.info({ appId, externalId }, "IAP updated on ASC");
	}

	async deleteInAppPurchase(appId: string, externalId: string): Promise<void> {
		if (this.isMock) {
			log.info({ appId, externalId }, "Mock: IAP deleted");
			return;
		}

		const { remove } = await createAppStoreClient(this.credentials);
		await remove({ id: externalId, type: "inAppPurchases" }, { version: 2 });

		log.info({ appId, externalId }, "IAP deleted from ASC");
	}

	async updateSubscriptionGroup(
		appId: string,
		groupExternalId: string,
		name: string,
	): Promise<void> {
		if (this.isMock) {
			log.info(
				{ appId, groupExternalId, name },
				"Mock: subscription group updated",
			);
			return;
		}

		const { update } = await createAppStoreClient(this.credentials);

		await update(
			{ id: groupExternalId, type: "subscriptionGroups" },
			{ attributes: { referenceName: name } },
		);

		log.info(
			{ appId, groupExternalId, name },
			"Subscription group updated on ASC",
		);
	}

	async createSubscriptionGroup(
		appId: string,
		name: string,
	): Promise<SubscriptionGroupData> {
		if (this.isMock) {
			log.info({ appId, name }, "Mock: subscription group created");
			return {
				externalId: `mock-group-${Date.now()}`,
				name,
				subscriptions: [],
			};
		}

		const { create } = await createAppStoreClient(this.credentials);

		const result = await create({
			attributes: { referenceName: name },
			relationships: {
				app: { data: { id: appId, type: "apps" } },
			},
			type: "subscriptionGroups",
		});

		log.info(
			{ appId, groupId: result.id, name },
			"Subscription group created on ASC",
		);

		return {
			externalId: result.id,
			name,
			subscriptions: [],
		};
	}

	async createSubscription(
		appId: string,
		groupExternalId: string,
		data: SubscriptionCreateData,
	): Promise<InAppPurchaseData> {
		if (this.isMock) {
			log.info(
				{ appId, productId: data.productId },
				"Mock: subscription created",
			);
			return {
				duration: data.duration,
				externalId: `mock-sub-${Date.now()}`,
				groupExternalId,
				localizations: data.localizations ?? [],
				name: data.name,
				prices: data.prices ?? [],
				productId: data.productId,
				productType: "auto_renewable",
				status: "draft",
			};
		}

		const { create } = await createAppStoreClient(this.credentials);

		const ascDuration = ISO_TO_ASC_DURATION[data.duration] ?? data.duration;

		const result = await create({
			attributes: {
				name: data.name,
				productId: data.productId,
				subscriptionPeriod: ascDuration,
			},
			relationships: {
				group: {
					data: { id: groupExternalId, type: "subscriptionGroups" },
				},
			},
			type: "subscriptions",
		});

		const subId = result.id;

		// Create localizations
		for (const loc of data.localizations ?? []) {
			await create({
				attributes: {
					description: loc.description ?? "",
					locale: loc.language,
					name: loc.name ?? data.name,
				},
				relationships: {
					subscription: { data: { id: subId, type: "subscriptions" } },
				},
				type: "subscriptionLocalizations",
			});
		}

		log.info(
			{ appId, productId: data.productId, subId },
			"Subscription created on ASC",
		);

		return {
			duration: data.duration,
			externalId: subId,
			groupExternalId,
			localizations: data.localizations ?? [],
			name: data.name,
			prices: data.prices ?? [],
			productId: data.productId,
			productType: "auto_renewable",
			status: "draft",
		};
	}

	async updateSubscription(
		appId: string,
		subExternalId: string,
		data: SubscriptionUpdateData,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId, subExternalId }, "Mock: subscription updated");
			return;
		}

		const { readAll, update } = await createAppStoreClient(this.credentials);

		if (data.name) {
			await update(
				{ id: subExternalId, type: "subscriptions" },
				{ attributes: { name: data.name } },
			);
		}

		if (data.localizations?.length) {
			const { data: existingLocs } = await readAll(
				`subscriptions/${subExternalId}/subscriptionLocalizations`,
			);

			for (const loc of data.localizations) {
				const existing = (existingLocs as ApiResource[])?.find(
					(l) => l.attributes.locale === loc.language,
				);

				if (existing) {
					await update(
						{ id: existing.id, type: "subscriptionLocalizations" },
						{
							attributes: {
								description: loc.description ?? "",
								name: loc.name ?? "",
							},
						},
					);
				}
			}
		}

		log.info({ appId, subExternalId }, "Subscription updated on ASC");
	}

	async deleteSubscription(
		appId: string,
		subExternalId: string,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId, subExternalId }, "Mock: subscription deleted");
			return;
		}

		const { remove } = await createAppStoreClient(this.credentials);
		await remove({ id: subExternalId, type: "subscriptions" });

		log.info({ appId, subExternalId }, "Subscription deleted from ASC");
	}

	async checkMonetizationSupport(
		_appId: string,
	): Promise<{ reason?: string; supported: boolean }> {
		return { supported: true };
	}

	private mapProductTypeToAsc(productType: string): string {
		switch (productType) {
			case "consumable":
				return "CONSUMABLE";
			case "non_consumable":
				return "NON_CONSUMABLE";
			case "non_renewing":
				return "NON_RENEWING_SUBSCRIPTION";
			default:
				return "CONSUMABLE";
		}
	}

	private mapIapType(ascType: string): string {
		switch (ascType) {
			case "CONSUMABLE":
				return "consumable";
			case "NON_CONSUMABLE":
				return "non_consumable";
			case "NON_RENEWING_SUBSCRIPTION":
				return "non_renewing";
			default:
				return ascType?.toLowerCase() ?? "consumable";
		}
	}

	private mapIapState(ascState: string): string {
		switch (ascState) {
			case "APPROVED":
				return "approved";
			case "DEVELOPER_ACTION_NEEDED":
			case "MISSING_METADATA":
				return "draft";
			case "WAITING_FOR_REVIEW":
			case "IN_REVIEW":
				return "in_review";
			case "REJECTED":
				return "rejected";
			case "REMOVED_FROM_SALE":
			case "DEVELOPER_REMOVED_FROM_SALE":
				return "removed";
			default:
				return ascState?.toLowerCase() ?? "draft";
		}
	}

	private mapSubState(ascState: string): string {
		switch (ascState) {
			case "APPROVED":
				return "approved";
			case "MISSING_METADATA":
			case "READY_TO_SUBMIT":
				return "draft";
			case "WAITING_FOR_REVIEW":
			case "IN_REVIEW":
				return "in_review";
			case "REJECTED":
				return "rejected";
			default:
				return ascState?.toLowerCase() ?? "draft";
		}
	}

	private async getEditableVersion(appId: string): Promise<ApiResource | null> {
		const { readAll } = await createAppStoreClient(this.credentials);
		const { data: versions } = await readAll(`apps/${appId}/appStoreVersions`);

		if (!versions?.length) return null;

		return findEditableVersion(versions as ApiResource[]);
	}
}

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
	CONTESTS: "contests",
	GAMBLING_CONTESTS: "gamblingSimulated",
	GRAPHIC_SEXUAL_CONTENT_NUDITY: "sexualContentGraphicAndNudity",
	GUNS_OR_OTHER_WEAPONS: "gunsOrOtherWeapons",
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
	ADVERTISING: "advertising",
	AGE_ASSURANCE: "ageAssurance",
	GAMBLING: "gambling",
	HEALTH_OR_WELLNESS_TOPICS: "healthOrWellnessTopics",
	LOOT_BOX: "lootBox",
	MESSAGING_AND_CHAT: "messagingAndChat",
	PARENTAL_CONTROLS: "parentalControls",
	UNRESTRICTED_WEB_ACCESS: "unrestrictedWebAccess",
	USER_GENERATED_CONTENT: "userGeneratedContent",
};

// ASC API uses INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE (with _OR_)
const INTERNAL_TO_ASC_VALUE: Record<string, string> = {
	FREQUENT_INTENSE: "FREQUENT_OR_INTENSE",
	INFREQUENT_MILD: "INFREQUENT_OR_MILD",
	NONE: "NONE",
};

// Maps internal privacy category keys to ASC API category values
const PRIVACY_CATEGORY_TO_ASC: Record<string, string> = {
	browsing_history: "BROWSING_HISTORY",
	contact_info: "CONTACT_INFO",
	contacts: "CONTACTS",
	diagnostics: "DIAGNOSTICS",
	financial: "FINANCIAL_INFO",
	health_fitness: "HEALTH_AND_FITNESS",
	identifiers: "IDENTIFIERS",
	location: "LOCATION",
	other: "OTHER_DATA",
	purchases: "PURCHASES",
	search_history: "SEARCH_HISTORY",
	sensitive_info: "SENSITIVE_INFO",
	usage_data: "USAGE_DATA",
	user_content: "USER_CONTENT",
};

// Maps internal data type display names to ASC API data type values
const PRIVACY_DATA_TYPE_TO_ASC: Record<string, string> = {
	"Audio Data": "AUDIO_DATA",
	"Browsing History": "BROWSING_HISTORY",
	"Coarse Location": "COARSE_LOCATION",
	Contacts: "CONTACTS",
	"Crash Data": "CRASH_DATA",
	"Credit Info": "CREDIT_INFO",
	"Customer Support": "CUSTOMER_SUPPORT",
	"Device ID": "DEVICE_ID",
	"Email Address": "EMAIL_ADDRESS",
	"Emails or Text Messages": "EMAILS_OR_TEXT_MESSAGES",
	Fitness: "FITNESS",
	"Gameplay Content": "GAMEPLAY_CONTENT",
	Health: "HEALTH",
	Name: "NAME",
	"Other Data": "OTHER_DATA",
	"Other Diagnostic Data": "OTHER_DIAGNOSTIC_DATA",
	"Other Financial Info": "OTHER_FINANCIAL_INFO",
	"Other Usage Data": "OTHER_USAGE_DATA",
	"Other User Content": "OTHER_USER_CONTENT",
	"Payment Info": "PAYMENT_INFO",
	"Performance Data": "PERFORMANCE_DATA",
	"Phone Number": "PHONE_NUMBER",
	"Photos or Videos": "PHOTOS_OR_VIDEOS",
	"Physical Address": "PHYSICAL_ADDRESS",
	"Precise Location": "PRECISE_LOCATION",
	"Product Interaction": "PRODUCT_INTERACTION",
	"Purchase History": "PURCHASE_HISTORY",
	"Search History": "SEARCH_HISTORY",
	"Sensitive Info": "SENSITIVE_INFO",
	"SMS or Calllog": "SMS_OR_CALLLOG",
	"User ID": "USER_ID",
};

// Maps internal purpose keys to ASC API purpose IDs
const PURPOSE_TO_ASC: Record<string, string> = {
	analytics: "ANALYTICS",
	app_functionality: "APP_FUNCTIONALITY",
	developers_advertising: "DEVELOPERS_ADVERTISING",
	other_purposes: "OTHER_PURPOSES",
	product_personalization: "PRODUCT_PERSONALIZATION",
	third_party_advertising: "THIRD_PARTY_ADVERTISING",
};

/**
 * ISO 3166-1 alpha-2 → alpha-3 territory code mapping.
 * ASC API uses alpha-3 codes for subscription price points and prices.
 */
const ALPHA2_TO_ALPHA3: Record<string, string> = {
	AE: "ARE",
	AF: "AFG",
	AG: "ATG",
	AI: "AIA",
	AL: "ALB",
	AM: "ARM",
	AO: "AGO",
	AR: "ARG",
	AT: "AUT",
	AU: "AUS",
	AZ: "AZE",
	BB: "BRB",
	BE: "BEL",
	BF: "BFA",
	BG: "BGR",
	BH: "BHR",
	BJ: "BEN",
	BM: "BMU",
	BN: "BRN",
	BO: "BOL",
	BR: "BRA",
	BS: "BHS",
	BT: "BTN",
	BW: "BWA",
	BY: "BLR",
	BZ: "BLZ",
	CA: "CAN",
	CD: "COD",
	CF: "CAF",
	CG: "COG",
	CH: "CHE",
	CI: "CIV",
	CL: "CHL",
	CM: "CMR",
	CN: "CHN",
	CO: "COL",
	CR: "CRI",
	CV: "CPV",
	CY: "CYP",
	CZ: "CZE",
	DE: "DEU",
	DK: "DNK",
	DM: "DMA",
	DO: "DOM",
	DZ: "DZA",
	EC: "ECU",
	EE: "EST",
	EG: "EGY",
	ER: "ERI",
	ES: "ESP",
	ET: "ETH",
	FI: "FIN",
	FJ: "FJI",
	FR: "FRA",
	GA: "GAB",
	GB: "GBR",
	GD: "GRD",
	GE: "GEO",
	GH: "GHA",
	GM: "GMB",
	GR: "GRC",
	GT: "GTM",
	GW: "GNB",
	GY: "GUY",
	HK: "HKG",
	HN: "HND",
	HR: "HRV",
	HU: "HUN",
	ID: "IDN",
	IE: "IRL",
	IL: "ISR",
	IN: "IND",
	IQ: "IRQ",
	IS: "ISL",
	IT: "ITA",
	JM: "JAM",
	JO: "JOR",
	JP: "JPN",
	KE: "KEN",
	KG: "KGZ",
	KH: "KHM",
	KN: "KNA",
	KR: "KOR",
	KW: "KWT",
	KY: "CYM",
	KZ: "KAZ",
	LA: "LAO",
	LB: "LBN",
	LC: "LCA",
	LK: "LKA",
	LR: "LBR",
	LT: "LTU",
	LU: "LUX",
	LV: "LVA",
	LY: "LBY",
	MA: "MAR",
	MD: "MDA",
	ME: "MNE",
	MG: "MDG",
	MK: "MKD",
	ML: "MLI",
	MM: "MMR",
	MN: "MNG",
	MO: "MAC",
	MR: "MRT",
	MS: "MSR",
	MT: "MLT",
	MU: "MUS",
	MV: "MDV",
	MW: "MWI",
	MX: "MEX",
	MY: "MYS",
	MZ: "MOZ",
	NA: "NAM",
	NE: "NER",
	NG: "NGA",
	NI: "NIC",
	NL: "NLD",
	NO: "NOR",
	NP: "NPL",
	NR: "NRU",
	NZ: "NZL",
	OM: "OMN",
	PA: "PAN",
	PE: "PER",
	PG: "PNG",
	PH: "PHL",
	PK: "PAK",
	PL: "POL",
	PT: "PRT",
	PW: "PLW",
	PY: "PRY",
	QA: "QAT",
	RO: "ROU",
	RS: "SRB",
	RU: "RUS",
	RW: "RWA",
	SA: "SAU",
	SB: "SLB",
	SC: "SYC",
	SE: "SWE",
	SG: "SGP",
	SI: "SVN",
	SK: "SVK",
	SL: "SLE",
	SN: "SEN",
	SR: "SUR",
	ST: "STP",
	SV: "SLV",
	SZ: "SWZ",
	TC: "TCA",
	TD: "TCD",
	TH: "THA",
	TJ: "TJK",
	TM: "TKM",
	TN: "TUN",
	TO: "TON",
	TR: "TUR",
	TT: "TTO",
	TW: "TWN",
	TZ: "TZA",
	UA: "UKR",
	UG: "UGA",
	US: "USA",
	UY: "URY",
	UZ: "UZB",
	VC: "VCT",
	VE: "VEN",
	VG: "VGB",
	VN: "VNM",
	VU: "VUT",
	YE: "YEM",
	ZA: "ZAF",
	ZM: "ZMB",
	ZW: "ZWE",
};

const ALPHA3_TO_ALPHA2: Record<string, string> = Object.fromEntries(
	Object.entries(ALPHA2_TO_ALPHA3).map(([a2, a3]) => [a3, a2]),
);

/** Convert territory code to alpha-3 (pass-through if already alpha-3) */
function toAlpha3(territory: string): string {
	if (territory.length === 3) return territory;
	return ALPHA2_TO_ALPHA3[territory] ?? territory;
}

/** Convert territory code to alpha-2 (pass-through if already alpha-2) */
function toAlpha2(territory: string): string {
	if (territory.length === 2) return territory;
	return ALPHA3_TO_ALPHA2[territory] ?? territory;
}

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

			// Ensure all required new fields are present (Apple returns 409 without them)
			const requiredBooleanDefaults: Record<string, boolean> = {
				advertising: false,
				ageAssurance: false,
				gambling: false,
				healthOrWellnessTopics: false,
				lootBox: false,
				messagingAndChat: false,
				parentalControls: false,
				userGeneratedContent: false,
			};
			const requiredStringDefaults: Record<string, string> = {
				contests: "NONE",
				gunsOrOtherWeapons: "NONE",
			};
			const finalAttributes = {
				...requiredBooleanDefaults,
				...requiredStringDefaults,
				...ascAttributes,
			};

			await update(
				{ id: declaration.id, type: "ageRatingDeclarations" },
				{ attributes: finalAttributes },
			);

			log.info(
				{ appId, fields: Object.keys(finalAttributes) },
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
		appId: string,
		data: import("../store-provider").PrivacyDeclarationData,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId }, "Mock: privacy declaration updated");
			return;
		}

		try {
			const { create, readAll, remove } = await createAppStoreClient(
				this.credentials,
			);

			// Step 1: Delete all existing privacy declarations (clean slate approach)
			const { data: existingUsages } = await readAll(
				`apps/${appId}/appDataUsages`,
			);

			for (const usage of (existingUsages ?? []) as ApiResource[]) {
				try {
					await remove({ id: usage.id, type: "appDataUsages" });
				} catch (err) {
					log.warn(
						{ err, usageId: usage.id },
						"Failed to delete existing app data usage — continuing",
					);
				}
			}

			// Step 2: If no data collections, we're done (app collects no data)
			if (!data.dataCollections?.length) {
				log.info(
					{ appId },
					"Privacy declaration cleared — no data collections to push",
				);
				return;
			}

			// Step 3: Create new privacy declarations for each data collection entry
			for (const collection of data.dataCollections) {
				const ascCategory =
					PRIVACY_CATEGORY_TO_ASC[collection.category] ?? collection.category;
				const ascDataType =
					PRIVACY_DATA_TYPE_TO_ASC[collection.dataType] ??
					collection.dataType.toUpperCase().replace(/\s+/g, "_");

				// Determine data protection level
				let dataProtectionId: string;
				if (collection.tracking) {
					dataProtectionId = "DATA_USED_TO_TRACK_YOU";
				} else if (collection.linked) {
					dataProtectionId = "DATA_LINKED_TO_YOU";
				} else {
					dataProtectionId = "DATA_NOT_LINKED_TO_YOU";
				}

				// Map purposes to ASC purpose IDs
				const ascPurposes = collection.purposes.map(
					(p) => PURPOSE_TO_ASC[p] ?? p.toUpperCase(),
				);

				try {
					await create({
						attributes: {
							category: ascCategory,
							dataType: ascDataType,
						},
						relationships: {
							app: { data: { id: appId, type: "apps" } },
							dataProtection: {
								data: {
									id: dataProtectionId,
									type: "appDataUsageDataProtections",
								},
							},
							purposes: {
								data: ascPurposes.map((purposeId) => ({
									id: purposeId,
									type: "appDataUsagePurposes",
								})),
							},
						},
						type: "appDataUsages",
					});
				} catch (err) {
					log.warn(
						{
							category: ascCategory,
							dataType: ascDataType,
							err,
						},
						"Failed to create app data usage entry — continuing with remaining entries",
					);
				}
			}

			log.info(
				{ appId, count: data.dataCollections.length },
				"Privacy declaration pushed to App Store Connect",
			);
		} catch (err) {
			log.error(
				{ appId, err },
				"Failed to update privacy declaration on App Store Connect",
			);
			throw err;
		}
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
			const { read, readAll } = await createAppStoreClient(this.credentials);

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

					// Fetch subscription prices with customer price resolution
					let prices: PurchasePriceData[] = [];
					try {
						const { data: subPricesData } = await readAll(
							`subscriptions/${sub.id}/prices`,
						);

						// Parse raw price entries (territory + pricePointId)
						const rawPrices = ((subPricesData ?? []) as ApiResource[]).map(
							(p) => {
								const ppId = (
									p.relationships?.subscriptionPricePoint?.data as
										| { id: string }
										| undefined
								)?.id;
								const territory = (
									p.relationships?.territory?.data as { id: string } | undefined
								)?.id;
								return {
									externalId: p.id,
									pricePointId: ppId,
									territory: territory ? toAlpha2(territory) : "US",
								};
							},
						);

						// Resolve each price point to customerPrice via single-page read
						prices = await Promise.all(
							rawPrices.map(async (rp) => {
								if (!rp.pricePointId) {
									return {
										currency: "USD",
										externalId: rp.externalId,
										price: "0",
										pricePointId: undefined,
										territory: rp.territory,
									};
								}

								try {
									const { data: pt } = await read(
										`subscriptionPricePoints/${rp.pricePointId}`,
									);
									const cp = (pt as ApiResource)?.attributes?.customerPrice as
										| string
										| undefined;
									return {
										currency: "USD",
										externalId: rp.externalId,
										price: cp ?? rp.pricePointId,
										pricePointId: rp.pricePointId,
										territory: rp.territory,
									};
								} catch {
									return {
										currency: "USD",
										externalId: rp.externalId,
										price: rp.pricePointId,
										pricePointId: rp.pricePointId,
										territory: rp.territory,
									};
								}
							}),
						);
					} catch {
						log.debug({ subId: sub.id }, "Could not fetch subscription prices");
					}

					const withPointId = prices.filter((p) => p.pricePointId);
					log.info(
						{
							subId: sub.id,
							totalPrices: prices.length,
							withPricePointId: withPointId.length,
						},
						"Subscription prices resolved",
					);

					const rawDuration = (attrs.subscriptionPeriod as string) ?? undefined;
					subscriptions.push({
						duration: rawDuration
							? (ASC_TO_ISO_DURATION[rawDuration] ?? rawDuration)
							: undefined,
						externalId: sub.id,
						familySharable:
							(attrs.familySharable as boolean | undefined) ?? false,
						groupExternalId: raw.id,
						localizations,
						name: (attrs.name as string) ?? localizations[0]?.name ?? "",
						prices,
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

		// Push prices if provided
		if (data.prices?.length) {
			await this.updateIapPrices(iapId, data.prices);
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

		const { create, readAll, update } = await createAppStoreClient(
			this.credentials,
		);

		if (data.name) {
			await update(
				{ id: externalId, type: "inAppPurchases" },
				{ attributes: { name: data.name }, version: 2 },
			);
		}

		// Update or create localizations
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
				} else {
					await create({
						attributes: {
							description: loc.description ?? "",
							locale: loc.language,
							name: loc.name ?? data.name ?? "",
						},
						relationships: {
							inAppPurchaseV2: {
								data: { id: externalId, type: "inAppPurchases" },
							},
						},
						type: "inAppPurchaseLocalizations",
					});
				}
			}
		}

		// Push prices if provided
		if (data.prices?.length) {
			await this.updateIapPrices(externalId, data.prices);
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

		// Push prices if provided
		if (data.prices?.length) {
			await this.updateSubscriptionPrices(subId, data.prices);
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

		const { create, readAll, update } = await createAppStoreClient(
			this.credentials,
		);

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

			const SUB_DESCRIPTION_MAX = 55;

			await Promise.allSettled(
				data.localizations.map(async (loc) => {
					const existing = (existingLocs as ApiResource[])?.find(
						(l) => l.attributes.locale === loc.language,
					);

					// Truncate description to Apple's 55-char limit for subscriptions
					const description = (loc.description ?? "").slice(
						0,
						SUB_DESCRIPTION_MAX,
					);

					try {
						if (existing) {
							await update(
								{
									id: existing.id,
									type: "subscriptionLocalizations",
								},
								{
									attributes: {
										description,
										name: loc.name ?? "",
									},
								},
							);
						} else {
							await create({
								attributes: {
									description,
									locale: loc.language,
									name: loc.name ?? data.name ?? "",
								},
								relationships: {
									subscription: {
										data: {
											id: subExternalId,
											type: "subscriptions",
										},
									},
								},
								type: "subscriptionLocalizations",
							});
						}
					} catch (err) {
						log.warn(
							{ err, language: loc.language, subExternalId },
							"Failed to push subscription localization — skipping",
						);
					}
				}),
			);
		}

		// Push prices if provided
		if (data.prices?.length) {
			await this.updateSubscriptionPrices(subExternalId, data.prices);
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

	async deleteSubscriptionGroup(
		appId: string,
		groupExternalId: string,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId, groupExternalId }, "Mock: subscription group deleted");
			return;
		}

		const { remove } = await createAppStoreClient(this.credentials);
		await remove({ id: groupExternalId, type: "subscriptionGroups" });

		log.info({ appId, groupExternalId }, "Subscription group deleted from ASC");
	}

	async updateFamilySharing(
		subscriptionExternalId: string,
		familySharable: boolean,
	): Promise<void> {
		if (this.isMock) {
			log.info(
				{ familySharable, subscriptionExternalId },
				"Mock: family sharing updated",
			);
			return;
		}

		const { update } = await createAppStoreClient(this.credentials);

		await update(
			{ id: subscriptionExternalId, type: "subscriptions" },
			{ attributes: { familySharable } },
		);

		log.info(
			{ familySharable, subscriptionExternalId },
			"Family sharing updated on ASC",
		);
	}

	async fetchGroupLocalizations(
		groupExternalId: string,
	): Promise<PurchaseLocalizationData[]> {
		if (this.isMock) {
			return [
				{ externalId: "mock-loc-1", language: "en-US", name: "Mock Group" },
			];
		}

		const { readAll } = await createAppStoreClient(this.credentials);

		const { data: locs } = await readAll(
			`subscriptionGroups/${groupExternalId}/subscriptionGroupLocalizations`,
		);

		const localizations: PurchaseLocalizationData[] = (
			(locs ?? []) as ApiResource[]
		).map((loc) => ({
			externalId: loc.id,
			language: (loc.attributes.locale as string) ?? "en-US",
			name: (loc.attributes.name as string) ?? undefined,
		}));

		log.info(
			{ count: localizations.length, groupExternalId },
			"Fetched group localizations from ASC",
		);
		return localizations;
	}

	async createGroupLocalization(
		groupExternalId: string,
		language: string,
		data: { name: string },
	): Promise<{ externalId: string }> {
		if (this.isMock) {
			log.info(
				{ groupExternalId, language },
				"Mock: group localization created",
			);
			return { externalId: `mock-gloc-${Date.now()}` };
		}

		const { create } = await createAppStoreClient(this.credentials);

		const result = await create({
			attributes: {
				locale: language,
				name: data.name,
			},
			relationships: {
				subscriptionGroup: {
					data: { id: groupExternalId, type: "subscriptionGroups" },
				},
			},
			type: "subscriptionGroupLocalizations",
		});

		log.info(
			{ externalId: result.id, groupExternalId, language },
			"Group localization created on ASC",
		);

		return { externalId: result.id };
	}

	async deleteGroupLocalization(localizationExternalId: string): Promise<void> {
		if (this.isMock) {
			log.info({ localizationExternalId }, "Mock: group localization deleted");
			return;
		}

		const { remove } = await createAppStoreClient(this.credentials);

		await remove({
			id: localizationExternalId,
			type: "subscriptionGroupLocalizations",
		});

		log.info({ localizationExternalId }, "Group localization deleted from ASC");
	}

	async updateGroupLocalization(
		localizationExternalId: string,
		data: { name: string },
	): Promise<void> {
		if (this.isMock) {
			log.info({ localizationExternalId }, "Mock: group localization updated");
			return;
		}

		const { update } = await createAppStoreClient(this.credentials);

		await update(
			{ id: localizationExternalId, type: "subscriptionGroupLocalizations" },
			{ attributes: { name: data.name } },
		);

		log.info({ localizationExternalId }, "Group localization updated on ASC");
	}

	async updateIapPrices(
		iapExternalId: string,
		prices: PurchasePriceData[],
	): Promise<void> {
		if (this.isMock) {
			log.info(
				{ count: prices.length, iapExternalId },
				"Mock: IAP prices updated",
			);
			return;
		}

		// Free IAPs (price=0) have no price points in ASC
		const usPrice = prices.find(
			(p) => p.territory === "US" || p.territory === "USA",
		);
		if (usPrice && Number.parseFloat(usPrice.price) === 0) {
			log.info({ iapExternalId }, "Skipping price push for free IAP");
			return;
		}

		const { create, readAll, remove } = await createAppStoreClient(
			this.credentials,
		);

		// Get or create price schedule
		let scheduleId: string;
		try {
			const { data: scheduleData } = await readAll(
				`v2/inAppPurchases/${iapExternalId}/iapPriceSchedule`,
			);
			const schedule = (
				Array.isArray(scheduleData) ? scheduleData[0] : scheduleData
			) as ApiResource | undefined;

			if (schedule) {
				scheduleId = schedule.id;
			} else {
				const newSchedule = await create({
					relationships: {
						inAppPurchase: {
							data: { id: iapExternalId, type: "inAppPurchases" },
						},
					},
					type: "inAppPurchasePriceSchedules",
				});
				scheduleId = newSchedule.id;
			}
		} catch {
			const newSchedule = await create({
				relationships: {
					inAppPurchase: {
						data: { id: iapExternalId, type: "inAppPurchases" },
					},
				},
				type: "inAppPurchasePriceSchedules",
			});
			scheduleId = newSchedule.id;
		}

		// Delete existing manual prices
		try {
			const { data: existingPrices } = await readAll(
				`inAppPurchasePriceSchedules/${scheduleId}/manualPrices`,
			);
			for (const existing of (existingPrices ?? []) as ApiResource[]) {
				try {
					await remove({
						id: existing.id,
						type: "inAppPurchasePrices",
					});
				} catch (err) {
					log.warn(
						{ err, priceId: existing.id },
						"Failed to delete existing IAP price — continuing",
					);
				}
			}
		} catch {
			log.debug({ scheduleId }, "No existing manual prices to delete");
		}

		// Create new manual prices
		for (const price of prices) {
			await create({
				relationships: {
					inAppPurchasePricePoint: {
						data: { id: price.price, type: "inAppPurchasePricePoints" },
					},
					inAppPurchasePriceSchedule: {
						data: { id: scheduleId, type: "inAppPurchasePriceSchedules" },
					},
					territory: {
						data: { id: price.territory, type: "territories" },
					},
				},
				type: "inAppPurchasePrices",
			});
		}

		log.info(
			{ count: prices.length, iapExternalId },
			"IAP prices updated on ASC",
		);
	}

	async updateSubscriptionPrices(
		subExternalId: string,
		prices: PurchasePriceData[],
	): Promise<void> {
		if (this.isMock) {
			log.info(
				{ count: prices.length, subExternalId },
				"Mock: subscription prices updated",
			);
			return;
		}

		// Free subscriptions (price=0) have no price points in ASC
		const usPrice = prices.find(
			(p) => p.territory === "US" || p.territory === "USA",
		);
		if (usPrice && Number.parseFloat(usPrice.price) === 0) {
			log.info({ subExternalId }, "Skipping price push for free subscription");
			return;
		}

		const { readAll, update } = await createAppStoreClient(this.credentials);

		// Build a map of territory (alpha-3) → pricePointId for all prices
		const pricesByTerritory = new Map<string, PurchasePriceData>();
		for (const p of prices) {
			pricesByTerritory.set(toAlpha3(p.territory), p);
		}

		// Collect prices that already have pricePointId
		const resolved = new Map<string, string>(); // alpha-3 → pricePointId
		for (const [alpha3, p] of pricesByTerritory) {
			if (p.pricePointId) {
				resolved.set(alpha3, p.pricePointId);
			}
		}

		// For unresolved prices, find matching price tier via USA base price + equalizations
		const unresolvedCount = pricesByTerritory.size - resolved.size;
		if (unresolvedCount > 0) {
			const usPrice =
				pricesByTerritory.get("USA") ??
				prices.find((p) => p.territory === "US");
			if (usPrice && /^\d+(\.\d+)?$/.test(usPrice.price)) {
				try {
					// Fetch all USA price tiers
					const { data: ppData } = await readAll(
						`subscriptions/${subExternalId}/pricePoints?filter[territory]=USA`,
					);
					const usTiers = ((ppData ?? []) as ApiResource[]).filter(
						(pp) => pp.attributes?.customerPrice != null,
					);

					const targetPrice = Number.parseFloat(usPrice.price);
					const matchedTier = usTiers.find(
						(pp) =>
							Math.abs(
								Number.parseFloat(pp.attributes.customerPrice as string) -
									targetPrice,
							) < 0.01,
					);

					if (matchedTier) {
						log.info(
							{ pricePointId: matchedTier.id, subExternalId, targetPrice },
							"Found matching US price tier",
						);
						resolved.set("USA", matchedTier.id);

						// Use equalizations to get pricePointIds for all territories
						const { data: eqData } = await readAll(
							`subscriptionPricePoints/${matchedTier.id}/equalizations`,
						);
						for (const eqItem of (eqData ?? []) as ApiResource[]) {
							// Territory is encoded in the base64 pricePointId
							try {
								const decoded = JSON.parse(
									Buffer.from(eqItem.id, "base64").toString("utf8"),
								);
								if (
									decoded.t &&
									pricesByTerritory.has(decoded.t) &&
									!resolved.has(decoded.t)
								) {
									resolved.set(decoded.t, eqItem.id);
								}
							} catch {
								// Non-base64 ID — try relationship territory
								const eqTerritory = (
									eqItem.relationships?.territory?.data as
										| { id: string }
										| undefined
								)?.id;
								if (
									eqTerritory &&
									pricesByTerritory.has(eqTerritory) &&
									!resolved.has(eqTerritory)
								) {
									resolved.set(eqTerritory, eqItem.id);
								}
							}
						}
					} else {
						log.warn(
							{ availableTiers: usTiers.length, subExternalId, targetPrice },
							"No matching US price tier found",
						);
					}
				} catch (err) {
					log.warn(
						{ err, subExternalId },
						"Failed to resolve price points via equalizations",
					);
				}
			} else {
				log.warn(
					{ subExternalId },
					"No US price available — cannot resolve price points",
				);
			}
		}

		if (resolved.size === 0) {
			log.warn({ subExternalId }, "No price points resolved — skipping");
			return;
		}

		// Use PATCH subscription with sideposting pattern (included array)
		// POST /v1/subscriptionPrices returns 409, but PATCH subscription works
		const pricesRelData: Array<{ id: string; type: string }> = [];
		const included: Array<{
			attributes: { preserveCurrentPrice: boolean };
			id: string;
			relationships: Record<string, { data: { id: string; type: string } }>;
			type: string;
		}> = [];

		for (const [alpha3, pricePointId] of resolved) {
			const localId = `\${price-${alpha3}}`;
			pricesRelData.push({ id: localId, type: "subscriptionPrices" });
			included.push({
				attributes: { preserveCurrentPrice: false },
				id: localId,
				relationships: {
					subscription: {
						data: { id: subExternalId, type: "subscriptions" },
					},
					subscriptionPricePoint: {
						data: { id: pricePointId, type: "subscriptionPricePoints" },
					},
					territory: {
						data: { id: alpha3, type: "territories" },
					},
				},
				type: "subscriptionPrices",
			});
		}

		try {
			await update(
				{ id: subExternalId, type: "subscriptions" },
				{
					included,
					relationships: {
						prices: { data: pricesRelData },
					},
				},
			);
			log.info(
				{ count: resolved.size, subExternalId, total: prices.length },
				"Subscription prices updated on ASC",
			);
		} catch (err) {
			log.error(
				{ err, resolvedCount: resolved.size, subExternalId },
				"Failed to update subscription prices via PATCH",
			);
		}
	}

	async fetchSubscriptionAvailability(
		subscriptionExternalId: string,
	): Promise<string[]> {
		if (this.isMock) {
			return ["US", "GB", "DE"];
		}

		const { read, readAll } = await createAppStoreClient(this.credentials);

		const { data: availData } = await read(
			`subscriptions/${subscriptionExternalId}/subscriptionAvailability`,
		);
		const availability = (
			Array.isArray(availData) ? availData[0] : availData
		) as ApiResource | undefined;

		if (!availability) return [];

		const { data: territoriesData } = await readAll(
			`subscriptionAvailabilities/${availability.id}/availableTerritories`,
		);

		const territories = ((territoriesData ?? []) as ApiResource[]).map((t) =>
			toAlpha2(t.id),
		);

		log.info(
			{ count: territories.length, subscriptionExternalId },
			"Fetched subscription availability from ASC",
		);
		return territories;
	}

	async updateSubscriptionAvailability(
		subscriptionExternalId: string,
		territories: string[],
	): Promise<void> {
		if (this.isMock) {
			log.info(
				{ count: territories.length, subscriptionExternalId },
				"Mock: subscription availability updated",
			);
			return;
		}

		const { create, read, update } = await createAppStoreClient(
			this.credentials,
		);

		// Normalize territories to alpha-3 for ASC API
		const alpha3Territories = territories.map((t) => toAlpha3(t));

		const territoryData = alpha3Territories.map((t) => ({
			id: t,
			type: "territories",
		}));

		// Check if availability already exists
		try {
			const { data: availData } = await read(
				`subscriptions/${subscriptionExternalId}/subscriptionAvailability`,
			);
			const availability = (
				Array.isArray(availData) ? availData[0] : availData
			) as ApiResource | undefined;

			if (availability) {
				// PATCH existing availability
				await update(
					{
						attributes: {
							availableInNewTerritories: false,
						},
						id: availability.id,
						relationships: {
							availableTerritories: {
								data: territoryData,
							},
						},
						type: "subscriptionAvailabilities",
					},
					{ id: availability.id },
				);

				log.info(
					{
						availabilityId: availability.id,
						count: alpha3Territories.length,
						subscriptionExternalId,
					},
					"Subscription availability updated (PATCH) on ASC",
				);
				return;
			}
		} catch {
			log.debug(
				{ subscriptionExternalId },
				"No existing subscription availability found — creating new",
			);
		}

		// Create new availability
		await create({
			attributes: {
				availableInNewTerritories: false,
			},
			relationships: {
				availableTerritories: {
					data: territoryData,
				},
				subscription: {
					data: {
						id: subscriptionExternalId,
						type: "subscriptions",
					},
				},
			},
			type: "subscriptionAvailabilities",
		});

		log.info(
			{ count: alpha3Territories.length, subscriptionExternalId },
			"Subscription availability created on ASC",
		);
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

import { STORE_TYPE_LABELS, type StoreType } from "@/config/const";

/**
 * Per-connection store capabilities.
 *
 * A connection's power over a store is ultimately governed by the role granted
 * to the service account / API key in the store console — NOT by an OAuth scope
 * AppBoard requests (a Google service account uses one broad `androidpublisher`
 * scope). So these capabilities serve two purposes:
 *
 *  1. **Setup guidance** — which console roles / GCP APIs the user must grant
 *     for what they want to do (see `buildSetupPlan`).
 *  2. **Per-connection gating** — the subset flagged `gateable` is enforced by
 *     `storeCapabilityGuard`: if the user opted out of a capability for a given
 *     connection, the matching routes return 403 for that store's apps.
 *
 * `wired` is honest about what AppBoard actually does through the store API.
 * Google Play age-rating / categories / data-safety are `consoleOnly` because
 * they cannot be pushed through the API key — they are managed in Play Console.
 */

export const STORE_CAPABILITY_IDS = [
	"listings",
	"assets",
	"reviews",
	"publishing",
	"purchases",
	"age_rating",
	"categories",
	"privacy",
] as const;

export type StoreCapabilityId = (typeof STORE_CAPABILITY_IDS)[number];

export interface StoreCapabilityDefinition {
	id: StoreCapabilityId;
	storeType: StoreType;
	name: string;
	/** Plain-language "what you'll be able to edit" for the setup screen. */
	description: string;
	/** Always on for this store type — shown checked + locked, cannot be removed. */
	core: boolean;
	/** Truthfully implemented through the store API today. */
	wired: boolean;
	/** Managed in the store console, not editable through the API key. */
	consoleOnly: boolean;
	/** Enforced per-connection by `storeCapabilityGuard` (403 when opted out). */
	gateable: boolean;
	/** Other capabilities that must be enabled for this one to work. */
	dependsOn: StoreCapabilityId[];
	/** Console role(s) / permission(s) to grant for this capability. */
	consoleRoles: string[];
	/** GCP APIs to enable for this capability (Google Play only). */
	gcpApis: string[];
}

const ANDROID_PUBLISHER_API = "androidpublisher.googleapis.com";
const PLAY_REPORTING_API = "playdeveloperreporting.googleapis.com";

const GOOGLE_PLAY_CAPABILITIES: StoreCapabilityDefinition[] = [
	{
		consoleOnly: false,
		consoleRoles: ["Edit store listing, pricing & distribution"],
		core: true,
		dependsOn: [],
		description:
			"Edit the store listing text — app title, short description and full description.",
		gateable: false,
		gcpApis: [ANDROID_PUBLISHER_API],
		id: "listings",
		name: "Store listing",
		storeType: "google_play",
		wired: true,
	},
	{
		consoleOnly: false,
		consoleRoles: ["Edit store listing, pricing & distribution"],
		core: true,
		dependsOn: [],
		description:
			"Upload and manage screenshots, the feature graphic and the app icon.",
		gateable: false,
		gcpApis: [ANDROID_PUBLISHER_API],
		id: "assets",
		name: "Screenshots & graphics",
		storeType: "google_play",
		wired: true,
	},
	{
		consoleOnly: false,
		consoleRoles: ["Reply to reviews"],
		core: false,
		dependsOn: [],
		description: "Read user reviews and post public replies.",
		gateable: true,
		gcpApis: [ANDROID_PUBLISHER_API],
		id: "reviews",
		name: "Reviews",
		storeType: "google_play",
		wired: true,
	},
	{
		consoleOnly: false,
		consoleRoles: [
			"Edit store listing, pricing & distribution",
			"Release to production, exclude devices, and use Play App Signing",
		],
		core: false,
		dependsOn: ["listings"],
		description:
			"Push your listing changes to Google Play and send them for review.",
		gateable: true,
		gcpApis: [ANDROID_PUBLISHER_API],
		id: "publishing",
		name: "Publishing",
		storeType: "google_play",
		wired: true,
	},
	{
		consoleOnly: false,
		consoleRoles: ["Manage orders and subscriptions"],
		core: false,
		dependsOn: [],
		description:
			"Create and edit in-app products and subscriptions — prices, availability and localizations.",
		gateable: true,
		gcpApis: [ANDROID_PUBLISHER_API],
		id: "purchases",
		name: "In-app products & subscriptions",
		storeType: "google_play",
		wired: true,
	},
	{
		consoleOnly: true,
		consoleRoles: [],
		core: false,
		dependsOn: [],
		description:
			"Age rating is set via the IARC questionnaire in Play Console — it cannot be changed through the API key.",
		gateable: false,
		gcpApis: [],
		id: "age_rating",
		name: "Age rating (IARC)",
		storeType: "google_play",
		wired: false,
	},
	{
		consoleOnly: true,
		consoleRoles: [],
		core: false,
		dependsOn: [],
		description:
			"The app category is set in Play Console and cannot be changed through the API key.",
		gateable: false,
		gcpApis: [],
		id: "categories",
		name: "Category",
		storeType: "google_play",
		wired: false,
	},
	{
		consoleOnly: true,
		consoleRoles: [],
		core: false,
		dependsOn: [],
		description:
			"The Data safety form is completed in Play Console and cannot be changed through the API key.",
		gateable: false,
		gcpApis: [],
		id: "privacy",
		name: "Data safety",
		storeType: "google_play",
		wired: false,
	},
];

const APP_MANAGER = "App Manager";

const APP_STORE_CAPABILITIES: StoreCapabilityDefinition[] = [
	{
		consoleOnly: false,
		consoleRoles: [APP_MANAGER],
		core: true,
		dependsOn: [],
		description:
			"Edit app information and per-language localizations — name, subtitle, keywords, description, promotional text.",
		gateable: false,
		gcpApis: [],
		id: "listings",
		name: "App information",
		storeType: "app_store",
		wired: true,
	},
	{
		consoleOnly: false,
		consoleRoles: [APP_MANAGER],
		core: true,
		dependsOn: [],
		// App previews (video) are not wired through the API yet - only
		// screenshots are read and uploaded, so the label must not promise them.
		description: "Upload and manage screenshots.",
		gateable: false,
		gcpApis: [],
		id: "assets",
		name: "Screenshots",
		storeType: "app_store",
		wired: true,
	},
	{
		consoleOnly: false,
		consoleRoles: [APP_MANAGER],
		core: false,
		dependsOn: [],
		description: "Read ratings and reviews and post replies.",
		gateable: true,
		gcpApis: [],
		id: "reviews",
		name: "Ratings & reviews",
		storeType: "app_store",
		wired: true,
	},
	{
		consoleOnly: false,
		consoleRoles: [APP_MANAGER],
		core: false,
		dependsOn: ["listings"],
		description:
			"Create app versions, edit version localizations and submit for review.",
		gateable: true,
		gcpApis: [],
		id: "publishing",
		name: "Versions & submission",
		storeType: "app_store",
		wired: true,
	},
	{
		consoleOnly: false,
		consoleRoles: [APP_MANAGER],
		core: false,
		dependsOn: [],
		description:
			"Manage in-app purchases and subscription groups — prices, availability and localizations.",
		gateable: true,
		gcpApis: [],
		id: "purchases",
		name: "In-app purchases & subscriptions",
		storeType: "app_store",
		wired: true,
	},
	{
		consoleOnly: false,
		consoleRoles: [APP_MANAGER],
		core: false,
		dependsOn: [],
		description: "Manage the age rating declaration.",
		gateable: false,
		gcpApis: [],
		id: "age_rating",
		name: "Age rating",
		storeType: "app_store",
		wired: true,
	},
	{
		consoleOnly: false,
		consoleRoles: [APP_MANAGER],
		core: false,
		dependsOn: [],
		description: "Set the app's primary and secondary categories.",
		gateable: false,
		gcpApis: [],
		id: "categories",
		name: "Categories",
		storeType: "app_store",
		wired: true,
	},
	{
		consoleOnly: false,
		consoleRoles: [APP_MANAGER],
		core: false,
		dependsOn: [],
		description: "Manage the app privacy details and data collection.",
		gateable: false,
		gcpApis: [],
		id: "privacy",
		name: "App privacy",
		storeType: "app_store",
		wired: true,
	},
];

/**
 * Alternative Android stores. Their developer APIs are far narrower than
 * App Store Connect / Google Play — most have no reviews, monetization or
 * age-rating endpoints at all — so the catalog is generated from an explicit
 * list of what each provider truly implements. Anything not named in the
 * overrides is `consoleOnly`, matching the methods left unimplemented on
 * `AlternativeStoreProvider` (which raise a typed error rather than no-op).
 */

const CAPABILITY_NAMES: Record<StoreCapabilityId, string> = {
	age_rating: "Age rating",
	assets: "Screenshots",
	categories: "Category",
	listings: "Store listing",
	privacy: "Privacy declaration",
	publishing: "Publishing",
	purchases: "In-app products & subscriptions",
	reviews: "Reviews",
};

const CAPABILITY_SUBJECTS: Record<StoreCapabilityId, string> = {
	age_rating: "The age rating",
	assets: "Screenshots and graphics",
	categories: "The app category",
	listings: "The store listing text",
	privacy: "The privacy declaration",
	publishing: "Submitting the app for review",
	purchases: "In-app products and subscriptions",
	reviews: "User reviews",
};

interface AltCapabilityOverride {
	consoleRoles?: string[];
	core?: boolean;
	description: string;
	gateable?: boolean;
	wired: boolean;
}

function buildAlternativeCapabilities(
	storeType: StoreType,
	overrides: Partial<Record<StoreCapabilityId, AltCapabilityOverride>>,
): StoreCapabilityDefinition[] {
	const label = STORE_TYPE_LABELS[storeType];

	return STORE_CAPABILITY_IDS.map((id) => {
		const override = overrides[id];
		const wired = override?.wired ?? false;

		return {
			consoleOnly: !wired,
			consoleRoles: override?.consoleRoles ?? [],
			core: override?.core ?? false,
			dependsOn: id === "publishing" && wired ? ["listings" as const] : [],
			description:
				override?.description ??
				`${CAPABILITY_SUBJECTS[id]} is managed in the ${label} developer console — it cannot be changed through the API.`,
			gateable: override?.gateable ?? false,
			gcpApis: [],
			id,
			name: CAPABILITY_NAMES[id],
			storeType,
			wired,
		};
	});
}

const HUAWEI_API_CLIENT_ROLE = "App administrator (AGC API client)";

const HUAWEI_CAPABILITIES = buildAlternativeCapabilities("huawei_appgallery", {
	assets: {
		description:
			"Screenshots already attached to a listing are read and shown here. AppGallery Connect has no API to attach a new image to a listing, so uploads are done in the console.",
		wired: false,
	},
	listings: {
		consoleRoles: [HUAWEI_API_CLIENT_ROLE],
		core: true,
		description:
			"Edit the per-language listing — app name, short description (brief info), full description and new features.",
		wired: true,
	},
	publishing: {
		consoleRoles: [HUAWEI_API_CLIENT_ROLE],
		description: "Submit the app for review and release it to AppGallery.",
		gateable: true,
		wired: true,
	},
});

const SAMSUNG_API_ROLE = "Seller Portal API service account (publishing scope)";

const SAMSUNG_CAPABILITIES = buildAlternativeCapabilities("samsung_galaxy", {
	assets: {
		consoleRoles: [SAMSUNG_API_ROLE],
		core: true,
		description: "Read and upload screenshots for each listing language.",
		wired: true,
	},
	listings: {
		consoleRoles: [SAMSUNG_API_ROLE],
		core: true,
		description:
			"Edit the per-language listing — app title, description and what's new.",
		wired: true,
	},
	publishing: {
		consoleRoles: [SAMSUNG_API_ROLE],
		description: "Submit the app for review in Galaxy Store.",
		gateable: true,
		wired: true,
	},
});

const AMAZON_SECURITY_PROFILE_ROLE =
	"Security profile allow-listed for the App Submission API";

const AMAZON_CAPABILITIES = buildAlternativeCapabilities("amazon_appstore", {
	assets: {
		consoleRoles: [AMAZON_SECURITY_PROFILE_ROLE],
		core: true,
		description: "Read, upload and delete screenshots per listing language.",
		wired: true,
	},
	listings: {
		consoleRoles: [AMAZON_SECURITY_PROFILE_ROLE],
		core: true,
		description:
			"Edit the per-language listing — title, short and full description, keywords and recent changes.",
		wired: true,
	},
	publishing: {
		consoleRoles: [AMAZON_SECURITY_PROFILE_ROLE],
		description:
			"Commit the open edit, which submits the app to Amazon for review.",
		gateable: true,
		wired: true,
	},
});

// RuStore publishes a new immutable draft per release rather than editing a
// listing in place, and does not document those endpoints in enough detail to
// wire honestly — only the app list is read through the API today.
const RUSTORE_CAPABILITIES = buildAlternativeCapabilities("rustore", {});

// ONE Store's public "v7 API" is the In-App Purchase server API; there is no
// app-submission API, so nothing beyond credential validation is possible.
const ONESTORE_CAPABILITIES = buildAlternativeCapabilities("onestore", {});

// Xiaomi documents only an APK push endpoint — no listing metadata API.
const XIAOMI_CAPABILITIES = buildAlternativeCapabilities("xiaomi_getapps", {});

export const STORE_CAPABILITY_CATALOG: StoreCapabilityDefinition[] = [
	...GOOGLE_PLAY_CAPABILITIES,
	...APP_STORE_CAPABILITIES,
	...HUAWEI_CAPABILITIES,
	...SAMSUNG_CAPABILITIES,
	...AMAZON_CAPABILITIES,
	...RUSTORE_CAPABILITIES,
	...ONESTORE_CAPABILITIES,
	...XIAOMI_CAPABILITIES,
];

export interface StoreSetupInfo {
	storeType: StoreType;
	/** GCP APIs that must always be enabled (Google Play only). */
	baseGcpApis: string[];
	/** Short human note shown at the top of the setup guide. */
	baseNote: string;
}

/**
 * Alternative stores need no GCP APIs; each carries the concrete steps for
 * creating an API client in its own developer console.
 */
function alternativeStoreSetup(
	storeType: StoreType,
	baseNote: string,
): StoreSetupInfo {
	return { baseGcpApis: [], baseNote, storeType };
}

export const STORE_SETUP_INFO: Record<StoreType, StoreSetupInfo> = {
	amazon_appstore: alternativeStoreSetup(
		"amazon_appstore",
		"In the Amazon Developer Console open Settings → Security Profiles, create (or pick) a security profile and copy its Client ID and Client Secret. Ask Amazon to allow-list the profile for the App Submission API, then add the package names of the apps you want to manage — Amazon has no endpoint that lists your apps.",
	),
	app_store: {
		baseGcpApis: [],
		baseNote:
			"Create an App Store Connect API key (Users and Access → Integrations → App Store Connect API) with the App Manager role, then note the Issuer ID and Key ID and download the .p8 key file.",
		storeType: "app_store",
	},
	google_play: {
		baseGcpApis: [ANDROID_PUBLISHER_API, PLAY_REPORTING_API],
		baseNote:
			"Create a service account, enable the required Google APIs on its project, then invite the service account email to your Play Console (Users & permissions) and grant it the roles for the capabilities you selected.",
		storeType: "google_play",
	},
	huawei_appgallery: alternativeStoreSetup(
		"huawei_appgallery",
		"In AppGallery Connect open Users and permissions → API key → Connect API, create an API client and copy its Client ID and Client Secret. Grant the client the App administrator role for your apps, then add the package names you want to manage — AppGallery has no endpoint that lists your apps.",
	),
	onestore: alternativeStoreSetup(
		"onestore",
		"In ONE Store Developer Center open your app → In-App → Credentials and copy the Client ID and Client Secret. ONE Store publishes no app-submission API, so AppBoard can only verify the credentials — listings, screenshots and releases are managed in Developer Center.",
	),
	rustore: alternativeStoreSetup(
		"rustore",
		"In RuStore Console open the API keys section, create a key and copy its Key ID together with the downloaded private key (PEM). AppBoard uses it to read your app list; RuStore publishes each release as a new immutable draft, so listing edits and releases stay in RuStore Console.",
	),
	samsung_galaxy: alternativeStoreSetup(
		"samsung_galaxy",
		"In Samsung Seller Portal open Assistance → API Service, create a service account with the publishing scope, then copy its Service Account ID and the downloaded private key (PEM).",
	),
	xiaomi_getapps: alternativeStoreSetup(
		"xiaomi_getapps",
		"In the Xiaomi Developer Console create an API key for your developer account and copy the account email together with the downloaded private key (PEM). Xiaomi documents only an APK push endpoint, so listings and screenshots are managed in the console.",
	),
};

/** All capability definitions for a store type, in display order. */
export function getCapabilityDefinitions(
	storeType: StoreType,
): StoreCapabilityDefinition[] {
	return STORE_CAPABILITY_CATALOG.filter((c) => c.storeType === storeType);
}

/** Capabilities the user can opt into (everything except console-only ones). */
export function getSelectableCapabilityIds(
	storeType: StoreType,
): StoreCapabilityId[] {
	return getCapabilityDefinitions(storeType)
		.filter((c) => !c.consoleOnly)
		.map((c) => c.id);
}

/** Capabilities always enabled for a store type (cannot be removed). */
export function getCoreCapabilityIds(
	storeType: StoreType,
): StoreCapabilityId[] {
	return getCapabilityDefinitions(storeType)
		.filter((c) => c.core)
		.map((c) => c.id);
}

/**
 * Default capability selection for a store type — used when a connection has no
 * explicit selection (legacy rows or an omitted request field). All selectable
 * capabilities are on by default so existing connections keep full access.
 */
export function resolveDefaultCapabilities(
	storeType: StoreType,
): StoreCapabilityId[] {
	return getSelectableCapabilityIds(storeType);
}

/**
 * What a credential-less (public link) connection can actually do: read the
 * store listing, its screenshots and its reviews. Publishing, purchases and the
 * metadata pushes all need an API key, so they must never be reported as
 * available for such a connection.
 */
export const PUBLIC_CONNECTION_CAPABILITIES: StoreCapabilityId[] = [
	"listings",
	"assets",
	"reviews",
];

/**
 * Normalize a user-provided capability selection for a store type:
 * drop unknown/console-only ids, always include core capabilities, and drop any
 * capability whose `dependsOn` is not satisfied. Returns a stable, de-duped list
 * in catalog order.
 */
export function validateCapabilitySelection(
	storeType: StoreType,
	ids: readonly string[],
): StoreCapabilityId[] {
	const defs = getCapabilityDefinitions(storeType);
	const selectable = new Set(getSelectableCapabilityIds(storeType));
	const chosen = new Set<StoreCapabilityId>();

	for (const id of ids) {
		if (selectable.has(id as StoreCapabilityId)) {
			chosen.add(id as StoreCapabilityId);
		}
	}
	for (const id of getCoreCapabilityIds(storeType)) chosen.add(id);

	// Drop capabilities whose dependencies are not met.
	for (const def of defs) {
		if (!chosen.has(def.id)) continue;
		if (def.dependsOn.some((dep) => !chosen.has(dep))) chosen.delete(def.id);
	}

	return defs.filter((d) => chosen.has(d.id)).map((d) => d.id);
}

export interface StoreSetupPlan {
	storeType: StoreType;
	baseNote: string;
	/** Console roles the user must grant, de-duped and in catalog order. */
	consoleRoles: string[];
	/** GCP APIs to enable (Google Play only), de-duped. */
	gcpApis: string[];
}

/**
 * Build the concrete setup plan (roles to grant + APIs to enable) for a given
 * capability selection. Powers the tailored setup guide / generated script.
 */
export function buildSetupPlan(
	storeType: StoreType,
	ids: readonly string[],
): StoreSetupPlan {
	const enabled = new Set(validateCapabilitySelection(storeType, ids));
	const info = STORE_SETUP_INFO[storeType];
	const roles: string[] = [];
	const gcpApis = new Set<string>(info.baseGcpApis);

	for (const def of getCapabilityDefinitions(storeType)) {
		if (!enabled.has(def.id)) continue;
		for (const role of def.consoleRoles) {
			if (!roles.includes(role)) roles.push(role);
		}
		for (const api of def.gcpApis) gcpApis.add(api);
	}

	return {
		baseNote: info.baseNote,
		consoleRoles: roles,
		gcpApis: [...gcpApis],
		storeType,
	};
}

/**
 * Map URL path patterns to the capability that gates them. Only `gateable`
 * capabilities appear here. Matched with the segment-aware `matchesPathPattern`
 * (see features.guard.ts) so `/purchases` never matches `/purchases-foo`.
 */
export const ROUTE_CAPABILITY_MAP: Array<{
	pattern: string;
	capability: StoreCapabilityId;
}> = [
	{ capability: "publishing", pattern: "/publishing" },
	{ capability: "reviews", pattern: "/reviews" },
	{ capability: "purchases", pattern: "/subscription-groups" },
	{ capability: "purchases", pattern: "/purchases" },
];

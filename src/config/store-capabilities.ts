import type { StoreType } from "@/config/const";

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
		description: "Upload and manage screenshots and app previews.",
		gateable: false,
		gcpApis: [],
		id: "assets",
		name: "Screenshots & previews",
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

export const STORE_CAPABILITY_CATALOG: StoreCapabilityDefinition[] = [
	...GOOGLE_PLAY_CAPABILITIES,
	...APP_STORE_CAPABILITIES,
];

export interface StoreSetupInfo {
	storeType: StoreType;
	/** GCP APIs that must always be enabled (Google Play only). */
	baseGcpApis: string[];
	/** Short human note shown at the top of the setup guide. */
	baseNote: string;
}

// Alternative stores connect with a simple API token today (stub integration),
// so their setup note is generic and they need no GCP APIs.
function alternativeStoreSetup(
	storeType: StoreType,
	label: string,
): StoreSetupInfo {
	return {
		baseGcpApis: [],
		baseNote: `Paste an API token from your ${label} developer console to connect it. Full publishing support for ${label} is coming soon.`,
		storeType,
	};
}

export const STORE_SETUP_INFO: Record<StoreType, StoreSetupInfo> = {
	amazon_appstore: alternativeStoreSetup("amazon_appstore", "Amazon Appstore"),
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
		"Huawei AppGallery",
	),
	onestore: alternativeStoreSetup("onestore", "ONE Store"),
	rustore: alternativeStoreSetup("rustore", "RuStore"),
	samsung_galaxy: alternativeStoreSetup(
		"samsung_galaxy",
		"Samsung Galaxy Store",
	),
	xiaomi_getapps: alternativeStoreSetup("xiaomi_getapps", "Xiaomi GetApps"),
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

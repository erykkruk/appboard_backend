import type {
	DataPurpose,
	GpDataCategory,
	GpDataPurpose,
	Platform,
	PrivacyCategory,
} from "@/config/const";

interface IosDataCollection {
	category: PrivacyCategory;
	dataType: string;
	linked: boolean;
	purposes: DataPurpose[];
	tracking: boolean;
}

interface GpDataCollection {
	category: GpDataCategory;
	collected: boolean;
	dataType: string;
	ephemeral: boolean;
	linked: boolean;
	purposes: GpDataPurpose[];
	required: boolean;
	shared: boolean;
	tracking: boolean;
}

type DataCollection = IosDataCollection | GpDataCollection;

export interface PrivacyTemplate {
	dataCollections: DataCollection[];
	description: string;
	id: string;
	name: string;
	platform: Platform;
}

// ---------------------------------------------------------------------------
// iOS Templates (App Store)
// ---------------------------------------------------------------------------

const IOS_TEMPLATES: PrivacyTemplate[] = [
	{
		dataCollections: [],
		description: "App does not collect any user data",
		id: "minimal",
		name: "Minimal (No Data Collection)",
		platform: "ios",
	},
	{
		dataCollections: [
			{
				category: "contact_info",
				dataType: "Email Address",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "identifiers",
				dataType: "User ID",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "usage_data",
				dataType: "Product Interaction",
				linked: false,
				purposes: ["analytics"],
				tracking: false,
			},
			{
				category: "diagnostics",
				dataType: "Crash Data",
				linked: false,
				purposes: ["analytics"],
				tracking: false,
			},
		],
		description: "Login, analytics, and crash reporting",
		id: "basic_app",
		name: "Basic App",
		platform: "ios",
	},
	{
		dataCollections: [
			{
				category: "contact_info",
				dataType: "Email Address",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "contact_info",
				dataType: "Name",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "contacts",
				dataType: "Contacts",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "location",
				dataType: "Precise Location",
				linked: true,
				purposes: ["app_functionality", "third_party_advertising"],
				tracking: true,
			},
			{
				category: "user_content",
				dataType: "Photos or Videos",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "user_content",
				dataType: "Other User Content",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "identifiers",
				dataType: "User ID",
				linked: true,
				purposes: ["app_functionality", "third_party_advertising"],
				tracking: true,
			},
			{
				category: "identifiers",
				dataType: "Device ID",
				linked: false,
				purposes: ["third_party_advertising"],
				tracking: true,
			},
			{
				category: "usage_data",
				dataType: "Product Interaction",
				linked: true,
				purposes: ["analytics", "product_personalization"],
				tracking: false,
			},
			{
				category: "diagnostics",
				dataType: "Crash Data",
				linked: false,
				purposes: ["analytics"],
				tracking: false,
			},
		],
		description: "Full data collection: contacts, location, UGC, ads, tracking",
		id: "social_media",
		name: "Social Media",
		platform: "ios",
	},
	{
		dataCollections: [
			{
				category: "contact_info",
				dataType: "Email Address",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "contact_info",
				dataType: "Name",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "contact_info",
				dataType: "Physical Address",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "financial",
				dataType: "Payment Info",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "purchases",
				dataType: "Purchase History",
				linked: true,
				purposes: ["app_functionality", "developers_advertising"],
				tracking: false,
			},
			{
				category: "identifiers",
				dataType: "User ID",
				linked: true,
				purposes: ["app_functionality", "third_party_advertising"],
				tracking: true,
			},
			{
				category: "identifiers",
				dataType: "Device ID",
				linked: false,
				purposes: ["third_party_advertising"],
				tracking: true,
			},
			{
				category: "usage_data",
				dataType: "Product Interaction",
				linked: true,
				purposes: ["analytics", "product_personalization"],
				tracking: false,
			},
			{
				category: "diagnostics",
				dataType: "Crash Data",
				linked: false,
				purposes: ["analytics"],
				tracking: false,
			},
		],
		description: "Payments, purchases, address, ads",
		id: "ecommerce",
		name: "E-commerce",
		platform: "ios",
	},
	{
		dataCollections: [
			{
				category: "contact_info",
				dataType: "Email Address",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "identifiers",
				dataType: "User ID",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "identifiers",
				dataType: "Device ID",
				linked: false,
				purposes: ["third_party_advertising"],
				tracking: true,
			},
			{
				category: "purchases",
				dataType: "Purchase History",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "usage_data",
				dataType: "Product Interaction",
				linked: true,
				purposes: ["analytics", "product_personalization"],
				tracking: false,
			},
			{
				category: "diagnostics",
				dataType: "Crash Data",
				linked: false,
				purposes: ["analytics"],
				tracking: false,
			},
		],
		description: "Ads, in-app purchases, leaderboards, analytics",
		id: "game",
		name: "Game",
		platform: "ios",
	},
	{
		dataCollections: [
			{
				category: "contact_info",
				dataType: "Email Address",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "health_fitness",
				dataType: "Health",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "health_fitness",
				dataType: "Fitness",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "location",
				dataType: "Precise Location",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "identifiers",
				dataType: "User ID",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "usage_data",
				dataType: "Product Interaction",
				linked: false,
				purposes: ["analytics"],
				tracking: false,
			},
			{
				category: "diagnostics",
				dataType: "Crash Data",
				linked: false,
				purposes: ["analytics"],
				tracking: false,
			},
		],
		description: "Health data, location, fitness tracking",
		id: "health_fitness",
		name: "Health & Fitness",
		platform: "ios",
	},
	{
		dataCollections: [],
		description: "Empty template — fill in your own data collections",
		id: "custom",
		name: "Custom",
		platform: "ios",
	},
];

// ---------------------------------------------------------------------------
// Helper for GP data collection items
// ---------------------------------------------------------------------------

function gpItem(
	category: GpDataCategory,
	dataType: string,
	purposes: GpDataPurpose[],
	overrides?: Partial<
		Pick<GpDataCollection, "collected" | "ephemeral" | "required" | "shared">
	>,
): GpDataCollection {
	return {
		category,
		collected: true,
		dataType,
		ephemeral: false,
		linked: false,
		purposes,
		required: true,
		shared: false,
		tracking: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Google Play Templates (Data Safety)
// ---------------------------------------------------------------------------

const GP_TEMPLATES: PrivacyTemplate[] = [
	{
		dataCollections: [],
		description: "App does not collect or share any user data",
		id: "gp_minimal",
		name: "Minimal (No Data Collection)",
		platform: "android",
	},
	{
		dataCollections: [
			gpItem("personal_info", "Email address", ["app_functionality"]),
			gpItem("device_ids", "Device or other IDs", [
				"analytics",
				"app_functionality",
			]),
			gpItem("app_info_performance", "Crash logs", ["analytics"]),
			gpItem("app_info_performance", "Diagnostics", ["analytics"]),
		],
		description: "Login, analytics, and crash reporting",
		id: "gp_basic_app",
		name: "Basic App",
		platform: "android",
	},
	{
		dataCollections: [
			gpItem("personal_info", "Name", ["app_functionality"]),
			gpItem("personal_info", "Email address", ["app_functionality"]),
			gpItem("personal_info", "Phone number", ["app_functionality"]),
			gpItem("contacts", "Contacts", ["app_functionality"]),
			gpItem("location", "Approximate location", [
				"app_functionality",
				"analytics",
			]),
			gpItem("location", "Precise location", [
				"app_functionality",
				"advertising_marketing",
			]),
			gpItem("photos_videos", "Photos", ["app_functionality"]),
			gpItem("photos_videos", "Videos", ["app_functionality"]),
			gpItem("app_activity", "App interactions", [
				"analytics",
				"personalization",
			]),
			gpItem("device_ids", "Device or other IDs", [
				"advertising_marketing",
				"analytics",
			]),
			gpItem("app_info_performance", "Crash logs", ["analytics"]),
		],
		description:
			"Full data collection: contacts, location, media, ads, analytics",
		id: "gp_social_media",
		name: "Social Media",
		platform: "android",
	},
	{
		dataCollections: [
			gpItem("personal_info", "Name", ["app_functionality"]),
			gpItem("personal_info", "Email address", ["app_functionality"]),
			gpItem("personal_info", "Address", ["app_functionality"]),
			gpItem("financial_info", "User payment info", ["app_functionality"]),
			gpItem("financial_info", "Purchase history", [
				"app_functionality",
				"advertising_marketing",
			]),
			gpItem("device_ids", "Device or other IDs", [
				"advertising_marketing",
				"analytics",
			]),
			gpItem("app_activity", "App interactions", [
				"analytics",
				"personalization",
			]),
			gpItem("app_info_performance", "Crash logs", ["analytics"]),
		],
		description: "Payments, purchases, address, marketing",
		id: "gp_ecommerce",
		name: "E-commerce",
		platform: "android",
	},
	{
		dataCollections: [
			gpItem("personal_info", "Email address", ["app_functionality"]),
			gpItem("financial_info", "Purchase history", ["app_functionality"]),
			gpItem("device_ids", "Device or other IDs", [
				"advertising_marketing",
				"analytics",
			]),
			gpItem("app_activity", "App interactions", [
				"analytics",
				"personalization",
			]),
			gpItem("app_info_performance", "Crash logs", ["analytics"]),
			gpItem("app_info_performance", "Diagnostics", ["analytics"]),
		],
		description: "Ads, in-app purchases, leaderboards, analytics",
		id: "gp_game",
		name: "Game",
		platform: "android",
	},
	{
		dataCollections: [
			gpItem("personal_info", "Email address", ["app_functionality"]),
			gpItem("health_fitness", "Health info", ["app_functionality"]),
			gpItem("health_fitness", "Fitness info", ["app_functionality"]),
			gpItem("location", "Approximate location", ["app_functionality"]),
			gpItem("location", "Precise location", ["app_functionality"]),
			gpItem("device_ids", "Device or other IDs", [
				"analytics",
				"app_functionality",
			]),
			gpItem("app_activity", "App interactions", ["analytics"]),
			gpItem("app_info_performance", "Crash logs", ["analytics"]),
		],
		description: "Health data, location, fitness tracking",
		id: "gp_health_fitness",
		name: "Health & Fitness",
		platform: "android",
	},
	{
		dataCollections: [],
		description: "Empty template — fill in your own data collections",
		id: "gp_custom",
		name: "Custom",
		platform: "android",
	},
];

// ---------------------------------------------------------------------------
// Combined
// ---------------------------------------------------------------------------

export const PRIVACY_TEMPLATES: PrivacyTemplate[] = [
	...IOS_TEMPLATES,
	...GP_TEMPLATES,
];

export function getPrivacyTemplate(
	templateId: string,
): PrivacyTemplate | undefined {
	return PRIVACY_TEMPLATES.find((t) => t.id === templateId);
}

export function getTemplatesByPlatform(platform?: string): PrivacyTemplate[] {
	if (!platform) return PRIVACY_TEMPLATES;
	return PRIVACY_TEMPLATES.filter((t) => t.platform === platform);
}

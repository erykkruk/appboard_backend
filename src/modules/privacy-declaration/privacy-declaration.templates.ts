import type { DataPurpose, PrivacyCategory } from "@/config/const";

interface DataCollection {
	category: PrivacyCategory;
	dataType: string;
	linked: boolean;
	purposes: DataPurpose[];
	tracking: boolean;
}

export interface PrivacyTemplate {
	dataCollections: DataCollection[];
	description: string;
	id: string;
	name: string;
}

export const PRIVACY_TEMPLATES: PrivacyTemplate[] = [
	{
		dataCollections: [],
		description: "App does not collect any user data",
		id: "minimal",
		name: "Minimal (No Data Collection)",
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
	},
	{
		dataCollections: [],
		description: "Empty template — fill in your own data collections",
		id: "custom",
		name: "Custom",
	},
];

export function getPrivacyTemplate(
	templateId: string,
): PrivacyTemplate | undefined {
	return PRIVACY_TEMPLATES.find((t) => t.id === templateId);
}

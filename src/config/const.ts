export const STORE_TYPES = ["google_play", "app_store"] as const;
export type StoreType = (typeof STORE_TYPES)[number];

export const PLATFORMS = ["android", "ios"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const STORE_STATUSES = ["connected", "error", "disconnected"] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

export const APP_STATUSES = ["active", "removed"] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export const LISTING_SOURCES = ["remote", "draft"] as const;
export type ListingSource = (typeof LISTING_SOURCES)[number];

export const READ_ONLY_FIELDS = ["id", "createdAt", "updatedAt"] as const;

// Privacy Declaration
export const PRIVACY_TEMPLATE_IDS = [
	"minimal",
	"basic_app",
	"social_media",
	"ecommerce",
	"game",
	"health_fitness",
	"custom",
] as const;
export type PrivacyTemplateId = (typeof PRIVACY_TEMPLATE_IDS)[number];

export const PRIVACY_CATEGORIES = [
	"contact_info",
	"health_fitness",
	"financial",
	"location",
	"sensitive_info",
	"contacts",
	"user_content",
	"browsing_history",
	"search_history",
	"identifiers",
	"purchases",
	"usage_data",
	"diagnostics",
	"other",
] as const;
export type PrivacyCategory = (typeof PRIVACY_CATEGORIES)[number];

export const DATA_PURPOSES = [
	"analytics",
	"app_functionality",
	"developers_advertising",
	"other_purposes",
	"product_personalization",
	"third_party_advertising",
] as const;
export type DataPurpose = (typeof DATA_PURPOSES)[number];

// Age Rating
export const AGE_RATING_PRESET_IDS = [
	"everyone",
	"everyone_mild",
	"teen",
	"mature",
	"custom",
] as const;
export type AgeRatingPresetId = (typeof AGE_RATING_PRESET_IDS)[number];

export const APPLE_RATING_QUESTIONS = [
	"CARTOON_FANTASY_VIOLENCE",
	"REALISTIC_VIOLENCE",
	"PROLONGED_GRAPHIC_SADISTIC_REALISTIC_VIOLENCE",
	"PROFANITY_CRUDE_HUMOR",
	"MATURE_SUGGESTIVE",
	"HORROR_FEAR_THEMES",
	"MEDICAL_TREATMENT_INFO",
	"ALCOHOL_TOBACCO_DRUG_USE",
	"SIMULATED_GAMBLING",
	"SEXUAL_CONTENT_NUDITY",
	"GRAPHIC_SEXUAL_CONTENT_NUDITY",
	"UNRESTRICTED_WEB_ACCESS",
	"GAMBLING_CONTESTS",
] as const;
export type AppleRatingQuestion = (typeof APPLE_RATING_QUESTIONS)[number];

export const APPLE_ANSWER_VALUES = [
	"NONE",
	"INFREQUENT_MILD",
	"FREQUENT_INTENSE",
] as const;
export type AppleAnswerValue = (typeof APPLE_ANSWER_VALUES)[number];

// App Store Categories (App Store Connect category IDs)
export const APP_STORE_CATEGORIES = [
	{ id: "BOOKS", name: "Books" },
	{ id: "BUSINESS", name: "Business" },
	{ id: "DEVELOPER_TOOLS", name: "Developer Tools" },
	{ id: "EDUCATION", name: "Education" },
	{ id: "ENTERTAINMENT", name: "Entertainment" },
	{ id: "FINANCE", name: "Finance" },
	{ id: "FOOD_AND_DRINK", name: "Food & Drink" },
	{ id: "GAMES", name: "Games" },
	{ id: "GRAPHICS_AND_DESIGN", name: "Graphics & Design" },
	{ id: "HEALTH_AND_FITNESS", name: "Health & Fitness" },
	{ id: "LIFESTYLE", name: "Lifestyle" },
	{ id: "MAGAZINES_AND_NEWSPAPERS", name: "Magazines & Newspapers" },
	{ id: "MEDICAL", name: "Medical" },
	{ id: "MUSIC", name: "Music" },
	{ id: "NAVIGATION", name: "Navigation" },
	{ id: "NEWS", name: "News" },
	{ id: "PHOTO_AND_VIDEO", name: "Photo & Video" },
	{ id: "PRODUCTIVITY", name: "Productivity" },
	{ id: "REFERENCE", name: "Reference" },
	{ id: "SHOPPING", name: "Shopping" },
	{ id: "SOCIAL_NETWORKING", name: "Social Networking" },
	{ id: "SPORTS", name: "Sports" },
	{ id: "STICKERS", name: "Stickers" },
	{ id: "TRAVEL", name: "Travel" },
	{ id: "UTILITIES", name: "Utilities" },
	{ id: "WEATHER", name: "Weather" },
] as const;

export type AppStoreCategory = (typeof APP_STORE_CATEGORIES)[number]["id"];

export const CHAR_LIMITS = {
	APP_STORE: {
		description: 4000,
		keywords: 100,
		name: 30,
		promotionalText: 170,
		subtitle: 30,
		whatsNew: 4000,
	},
	GOOGLE_PLAY: {
		fullDescription: 4000,
		shortDescription: 80,
		title: 50,
	},
} as const;

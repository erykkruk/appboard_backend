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

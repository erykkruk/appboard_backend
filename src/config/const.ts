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
	"gp_minimal",
	"gp_basic_app",
	"gp_social_media",
	"gp_ecommerce",
	"gp_game",
	"gp_health_fitness",
	"gp_custom",
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

// Google Play Data Safety
export const GP_DATA_PURPOSES = [
	"app_functionality",
	"analytics",
	"developer_communications",
	"advertising_marketing",
	"fraud_prevention",
	"personalization",
	"account_management",
] as const;
export type GpDataPurpose = (typeof GP_DATA_PURPOSES)[number];

export const GP_DATA_CATEGORIES = [
	"location",
	"personal_info",
	"financial_info",
	"health_fitness",
	"messages",
	"photos_videos",
	"audio",
	"files_docs",
	"calendar",
	"contacts",
	"app_activity",
	"web_browsing",
	"app_info_performance",
	"device_ids",
] as const;
export type GpDataCategory = (typeof GP_DATA_CATEGORIES)[number];

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

// In-App Purchases
export const PURCHASE_PRODUCT_TYPES = [
	"auto_renewable",
	"non_renewing",
	"consumable",
	"non_consumable",
] as const;
export type PurchaseProductType = (typeof PURCHASE_PRODUCT_TYPES)[number];

export const PURCHASE_STATUSES = [
	"approved",
	"draft",
	"in_review",
	"rejected",
	"removed",
	"waiting_for_review",
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

// App Store Connect Territories (most common)
export const ASC_TERRITORIES = [
	{ code: "AE", currency: "AED", name: "United Arab Emirates" },
	{ code: "AR", currency: "ARS", name: "Argentina" },
	{ code: "AT", currency: "EUR", name: "Austria" },
	{ code: "AU", currency: "AUD", name: "Australia" },
	{ code: "BE", currency: "EUR", name: "Belgium" },
	{ code: "BG", currency: "BGN", name: "Bulgaria" },
	{ code: "BR", currency: "BRL", name: "Brazil" },
	{ code: "CA", currency: "CAD", name: "Canada" },
	{ code: "CH", currency: "CHF", name: "Switzerland" },
	{ code: "CL", currency: "CLP", name: "Chile" },
	{ code: "CO", currency: "COP", name: "Colombia" },
	{ code: "CZ", currency: "CZK", name: "Czech Republic" },
	{ code: "DE", currency: "EUR", name: "Germany" },
	{ code: "DK", currency: "DKK", name: "Denmark" },
	{ code: "EE", currency: "EUR", name: "Estonia" },
	{ code: "EG", currency: "EGP", name: "Egypt" },
	{ code: "ES", currency: "EUR", name: "Spain" },
	{ code: "FI", currency: "EUR", name: "Finland" },
	{ code: "FR", currency: "EUR", name: "France" },
	{ code: "GB", currency: "GBP", name: "United Kingdom" },
	{ code: "GR", currency: "EUR", name: "Greece" },
	{ code: "HK", currency: "HKD", name: "Hong Kong" },
	{ code: "HR", currency: "EUR", name: "Croatia" },
	{ code: "HU", currency: "HUF", name: "Hungary" },
	{ code: "ID", currency: "IDR", name: "Indonesia" },
	{ code: "IE", currency: "EUR", name: "Ireland" },
	{ code: "IL", currency: "ILS", name: "Israel" },
	{ code: "IN", currency: "INR", name: "India" },
	{ code: "IT", currency: "EUR", name: "Italy" },
	{ code: "JP", currency: "JPY", name: "Japan" },
	{ code: "KE", currency: "KES", name: "Kenya" },
	{ code: "KR", currency: "KRW", name: "South Korea" },
	{ code: "LT", currency: "EUR", name: "Lithuania" },
	{ code: "LV", currency: "EUR", name: "Latvia" },
	{ code: "MX", currency: "MXN", name: "Mexico" },
	{ code: "MY", currency: "MYR", name: "Malaysia" },
	{ code: "NG", currency: "NGN", name: "Nigeria" },
	{ code: "NL", currency: "EUR", name: "Netherlands" },
	{ code: "NO", currency: "NOK", name: "Norway" },
	{ code: "NZ", currency: "NZD", name: "New Zealand" },
	{ code: "PE", currency: "PEN", name: "Peru" },
	{ code: "PH", currency: "PHP", name: "Philippines" },
	{ code: "PL", currency: "PLN", name: "Poland" },
	{ code: "PT", currency: "EUR", name: "Portugal" },
	{ code: "RO", currency: "RON", name: "Romania" },
	{ code: "RU", currency: "RUB", name: "Russia" },
	{ code: "SA", currency: "SAR", name: "Saudi Arabia" },
	{ code: "SE", currency: "SEK", name: "Sweden" },
	{ code: "SG", currency: "SGD", name: "Singapore" },
	{ code: "SI", currency: "EUR", name: "Slovenia" },
	{ code: "SK", currency: "EUR", name: "Slovakia" },
	{ code: "TH", currency: "THB", name: "Thailand" },
	{ code: "TR", currency: "TRY", name: "Turkey" },
	{ code: "TW", currency: "TWD", name: "Taiwan" },
	{ code: "UA", currency: "UAH", name: "Ukraine" },
	{ code: "US", currency: "USD", name: "United States" },
	{ code: "VN", currency: "VND", name: "Vietnam" },
	{ code: "ZA", currency: "ZAR", name: "South Africa" },
] as const;

export type AscTerritory = (typeof ASC_TERRITORIES)[number];

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

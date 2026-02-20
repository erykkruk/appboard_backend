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

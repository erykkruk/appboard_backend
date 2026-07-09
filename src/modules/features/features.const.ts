export const FEATURE_PREFIX = "FEATURE_" as const;

export type FeatureKey =
	| "AGE_RATING"
	| "AI"
	| "ASO_PROFILE"
	| "GROUPS"
	| "HISTORY"
	| "LISTINGS"
	| "MONETIZATION_CHAT"
	| "PRIVACY"
	| "PUBLISHING"
	| "PURCHASES"
	| "RESEARCH"
	| "REVIEWS"
	| "SCREENSHOTS";

export interface FeatureDefinition {
	key: FeatureKey;
	name: string;
	description: string;
	defaultEnabled: boolean;
	dependsOn?: FeatureKey[];
}

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
	{
		defaultEnabled: true,
		description: "Manage age rating questionnaires for apps",
		key: "AGE_RATING",
		name: "Age Rating",
	},
	{
		defaultEnabled: true,
		description: "AI-powered generation and optimization features",
		key: "AI",
		name: "AI Assistant",
	},
	{
		defaultEnabled: true,
		description: "Manage ASO profiles for apps and groups",
		key: "ASO_PROFILE",
		name: "ASO Profile",
	},
	{
		defaultEnabled: true,
		description: "Group apps together for shared configuration",
		key: "GROUPS",
		name: "App Groups",
	},
	{
		defaultEnabled: true,
		description: "Track changes and view history of app metadata",
		key: "HISTORY",
		name: "History",
	},
	{
		defaultEnabled: true,
		description:
			"Edit and manage store listings (title, description, keywords)",
		key: "LISTINGS",
		name: "Listings",
	},
	{
		defaultEnabled: true,
		dependsOn: ["AI", "PURCHASES"],
		description: "AI-powered chat for monetization strategy planning",
		key: "MONETIZATION_CHAT",
		name: "Monetization Chat",
	},
	{
		defaultEnabled: true,
		description: "Manage privacy declarations and data safety forms",
		key: "PRIVACY",
		name: "Privacy",
	},
	{
		defaultEnabled: true,
		description: "Publish changes to App Store and Google Play",
		key: "PUBLISHING",
		name: "Publishing",
	},
	{
		defaultEnabled: true,
		description: "Manage in-app purchases and subscriptions",
		key: "PURCHASES",
		name: "Purchases",
	},
	{
		defaultEnabled: true,
		description:
			"Market research: review analysis, keyword positions, competitor reports for any store app",
		key: "RESEARCH",
		name: "Research",
	},
	{
		defaultEnabled: true,
		description: "View and respond to app store reviews",
		key: "REVIEWS",
		name: "Reviews",
	},
	{
		defaultEnabled: true,
		description: "Manage screenshots and app store assets",
		key: "SCREENSHOTS",
		name: "Screenshots",
	},
];

/**
 * Map URL path patterns to feature keys. Order matters — more specific
 * patterns must come first, since matching is segment-aware (see
 * `matchesPathPattern` in features.guard.ts) and returns the first hit.
 *
 * Each pattern is matched as a contiguous segment subsequence, so
 * `/ai` matches `/api/ai/...` but NOT `/api/ai-chat-history`.
 */
export const ROUTE_FEATURE_MAP: Array<{
	pattern: string;
	feature: FeatureKey;
}> = [
	{ feature: "LISTINGS", pattern: "/listings/categories" },
	{ feature: "LISTINGS", pattern: "/listings" },
	{ feature: "SCREENSHOTS", pattern: "/screenshot-scenes" },
	{ feature: "SCREENSHOTS", pattern: "/assets" },
	{ feature: "PUBLISHING", pattern: "/publishing" },
	{ feature: "RESEARCH", pattern: "/research-runs" },
	{ feature: "RESEARCH", pattern: "/research" },
	{ feature: "RESEARCH", pattern: "/tracking" },
	{ feature: "REVIEWS", pattern: "/reviews" },
	{ feature: "MONETIZATION_CHAT", pattern: "/monetization-chat" },
	{ feature: "AI", pattern: "/ai" },
	{ feature: "PURCHASES", pattern: "/subscription-groups" },
	{ feature: "PURCHASES", pattern: "/purchases" },
	{ feature: "ASO_PROFILE", pattern: "/aso-profile" },
	{ feature: "AGE_RATING", pattern: "/age-rating" },
	{ feature: "PRIVACY", pattern: "/privacy-declaration" },
	{ feature: "PRIVACY", pattern: "/privacy-templates" },
	{ feature: "HISTORY", pattern: "/history" },
	{ feature: "GROUPS", pattern: "/app-groups" },
	{ feature: "GROUPS", pattern: "/groups" },
];

/**
 * Check whether a pattern (e.g. "/listings/categories") matches a pathname
 * by treating each path segment as an atomic unit. Prevents false positives
 * like "/api/ai" matching "/api/ai-chat-history".
 */
export function matchesPathPattern(pathname: string, pattern: string): boolean {
	const pathSegments = pathname.split("/").filter(Boolean);
	const patternSegments = pattern.split("/").filter(Boolean);

	if (patternSegments.length === 0) return false;
	if (patternSegments.length > pathSegments.length) return false;

	for (let i = 0; i <= pathSegments.length - patternSegments.length; i++) {
		let matches = true;
		for (let j = 0; j < patternSegments.length; j++) {
			if (pathSegments[i + j] !== patternSegments[j]) {
				matches = false;
				break;
			}
		}
		if (matches) return true;
	}
	return false;
}

import {
	boolean,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";

const timeColumns = {
	createdAt: timestamp().notNull().defaultNow(),
	updatedAt: timestamp({ mode: "date" })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
};

// ── Better Auth tables ──────────────────────────────────────────────

export const user = pgTable("user", {
	id: text().primaryKey(),
	...timeColumns,
	email: varchar({ length: 255 }).notNull().unique(),
	emailVerified: boolean().notNull().default(false),
	image: varchar({ length: 1024 }),
	name: varchar({ length: 255 }).notNull(),
});

export const session = pgTable("session", {
	id: text().primaryKey(),
	...timeColumns,
	expiresAt: timestamp().notNull(),
	ipAddress: varchar({ length: 255 }),
	token: text().notNull().unique(),
	userAgent: text(),
	userId: text()
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
	id: text().primaryKey(),
	...timeColumns,
	accessToken: text(),
	accessTokenExpiresAt: timestamp(),
	accountId: text().notNull(),
	idToken: text(),
	password: text(),
	providerId: text().notNull(),
	refreshToken: text(),
	refreshTokenExpiresAt: timestamp(),
	scope: text(),
	userId: text()
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const verification = pgTable("verification", {
	id: text().primaryKey(),
	...timeColumns,
	expiresAt: timestamp().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
});

// ── Workspace tables ────────────────────────────────────────────────

export const workspaces = pgTable("workspaces", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,
	name: varchar({ length: 255 }).notNull(),
});

export const workspaceMembers = pgTable(
	"workspace_members",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		role: varchar({ length: 20 }).notNull().default("owner"),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		workspaceId: uuid()
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
	},
	(t) => [unique().on(t.workspaceId, t.userId)],
);

// ── Domain tables ───────────────────────────────────────────────────

export const stores = pgTable("stores", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,
	credentials: text(),
	lastSyncedAt: timestamp(),
	name: varchar({ length: 255 }).notNull(),
	status: varchar({ length: 50 }).notNull().default("disconnected"),
	type: varchar({ length: 50 }).notNull(),
	workspaceId: uuid()
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
});

export const apps = pgTable("apps", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,
	bundleId: varchar({ length: 255 }).notNull(),
	externalId: varchar({ length: 255 }).notNull(),
	iconUrl: varchar({ length: 1024 }),
	lastSyncedAt: timestamp(),
	name: varchar({ length: 255 }).notNull(),
	platform: varchar({ length: 50 }).notNull(),
	primaryCategory: varchar({ length: 100 }),
	rawData: jsonb(),
	secondaryCategory: varchar({ length: 100 }),
	status: varchar({ length: 50 }).notNull().default("active"),
	storeId: uuid()
		.notNull()
		.references(() => stores.id, { onDelete: "cascade" }),
});

export const settings = pgTable(
	"settings",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		isEncrypted: boolean().notNull().default(false),
		key: varchar({ length: 255 }).notNull(),
		value: text(),
		workspaceId: uuid()
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
	},
	(t) => [unique().on(t.workspaceId, t.key)],
);

export const listings = pgTable(
	"listings",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		appId: uuid()
			.notNull()
			.references(() => apps.id, { onDelete: "cascade" }),
		fullDesc: text(),
		isDirty: boolean().notNull().default(false),
		keywords: varchar({ length: 255 }),
		language: varchar({ length: 20 }).notNull(),
		marketingUrl: varchar({ length: 1024 }),
		privacyUrl: varchar({ length: 1024 }),
		promoText: varchar({ length: 255 }),
		shortDesc: varchar({ length: 255 }),
		source: varchar({ length: 20 }).notNull().default("remote"),
		supportUrl: varchar({ length: 1024 }),
		syncedAt: timestamp(),
		title: varchar({ length: 255 }),
		videoUrl: varchar({ length: 1024 }),
		whatsNew: text(),
	},
	(t) => [unique().on(t.appId, t.language, t.source)],
);

export const listingHistory = pgTable("listing_history", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,
	appId: uuid()
		.notNull()
		.references(() => apps.id, { onDelete: "cascade" }),
	field: varchar({ length: 100 }).notNull(),
	language: varchar({ length: 20 }).notNull(),
	listingId: uuid().references(() => listings.id, { onDelete: "set null" }),
	newValue: text(),
	oldValue: text(),
	publishedAt: timestamp(),
});

export const assets = pgTable("assets", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,
	appId: uuid()
		.notNull()
		.references(() => apps.id, { onDelete: "cascade" }),
	assetType: varchar({ length: 50 }).notNull(),
	deviceType: varchar({ length: 50 }).notNull(),
	externalId: varchar({ length: 255 }),
	fileName: varchar({ length: 255 }),
	fileSize: integer(),
	height: integer(),
	isDirty: boolean().notNull().default(false),
	language: varchar({ length: 20 }).notNull(),
	sortOrder: integer().notNull().default(0),
	source: varchar({ length: 20 }).notNull().default("remote"),
	syncedAt: timestamp(),
	url: varchar({ length: 2048 }),
	width: integer(),
});

export const reviews = pgTable("reviews", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,
	appId: uuid()
		.notNull()
		.references(() => apps.id, { onDelete: "cascade" }),
	appVersion: varchar({ length: 50 }),
	authorName: varchar({ length: 255 }),
	body: text(),
	device: varchar({ length: 255 }),
	externalId: varchar({ length: 255 }).notNull(),
	language: varchar({ length: 20 }),
	osVersion: varchar({ length: 50 }),
	rating: integer().notNull(),
	repliedAt: timestamp(),
	replyText: text(),
	reviewDate: timestamp(),
	storeType: varchar({ length: 50 }).notNull(),
	syncedAt: timestamp(),
	territory: varchar({ length: 10 }),
	title: varchar({ length: 500 }),
});

export const appAsoProfiles = pgTable("app_aso_profiles", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,
	appId: uuid()
		.notNull()
		.references(() => apps.id, { onDelete: "cascade" })
		.unique(),

	// Social Proof
	awards: jsonb().$type<string[]>(),

	// Tone & Branding
	brandVoiceExample: text(),

	// Core Information
	category: text(),

	// Competitors
	competitiveAdvantage: text(),
	competitors: jsonb().$type<string[]>(),
	differentiator: text(),
	downloadCount: text(),

	// Keywords
	excludeKeywords: jsonb().$type<string[]>(),

	// Product Details
	freeFeatures: jsonb().$type<string[]>(),
	keyFeatures: jsonb().$type<string[]>(),
	longTailKeywords: jsonb().$type<string[]>(),
	mainBenefit: text(),
	mustIncludeKeywords: jsonb().$type<string[]>(),
	oneLiner: text(),

	// Audience
	painPoints: jsonb().$type<string[]>(),
	positioning: text(),
	premiumFeatures: jsonb().$type<string[]>(),
	pressQuotes: jsonb().$type<string[]>(),
	price: text(),
	pricingModel: text(),
	problem: text(),
	targetAudience: text(),
	testimonials: jsonb().$type<string[]>(),
	tone: text(),
	userLanguage: text(),
	wordsToAvoid: jsonb().$type<string[]>(),
	wordsToInclude: jsonb().$type<string[]>(),
});

export const appVersions = pgTable(
	"app_versions",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		appId: uuid()
			.notNull()
			.references(() => apps.id, { onDelete: "cascade" }),
		copyright: text(),
		copyrightDirty: boolean().notNull().default(false),
		externalId: varchar({ length: 255 }).notNull(),
		isEditable: boolean().notNull().default(false),
		state: varchar({ length: 100 }).notNull(),
		syncedAt: timestamp(),
		versionString: varchar({ length: 50 }).notNull(),
	},
	(t) => [unique().on(t.appId, t.externalId)],
);

export const versionLocalizations = pgTable(
	"version_localizations",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		appId: uuid()
			.notNull()
			.references(() => apps.id, { onDelete: "cascade" }),
		description: text(),
		externalId: varchar({ length: 255 }),
		isDirty: boolean().notNull().default(false),
		keywords: varchar({ length: 255 }),
		language: varchar({ length: 20 }).notNull(),
		marketingUrl: varchar({ length: 1024 }),
		promotionalText: text(),
		source: varchar({ length: 20 }).notNull().default("remote"),
		subtitle: varchar({ length: 255 }),
		supportUrl: varchar({ length: 1024 }),
		syncedAt: timestamp(),
		title: varchar({ length: 255 }),
		versionId: uuid()
			.notNull()
			.references(() => appVersions.id, { onDelete: "cascade" }),
		whatsNew: text(),
	},
	(t) => [unique().on(t.versionId, t.language, t.source)],
);

export const appAiPrompts = pgTable(
	"app_ai_prompts",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		appId: uuid()
			.notNull()
			.references(() => apps.id, { onDelete: "cascade" }),
		field: varchar({ length: 50 }).notNull(),
		mode: varchar({ length: 20 }).notNull(),
		prompt: text().notNull(),
	},
	(t) => [unique().on(t.appId, t.field, t.mode)],
);

export const appPrivacyDeclarations = pgTable("app_privacy_declarations", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,
	appId: uuid()
		.notNull()
		.references(() => apps.id, { onDelete: "cascade" })
		.unique(),
	dataCollections:
		jsonb().$type<
			Array<{
				category: string;
				collected?: boolean;
				dataType: string;
				ephemeral?: boolean;
				linked: boolean;
				purposes: string[];
				required?: boolean;
				shared?: boolean;
				tracking: boolean;
			}>
		>(),
	gpDeletionMechanism: boolean().notNull().default(false),
	gpEncryptedInTransit: boolean().notNull().default(false),
	privacyPolicyUrl: varchar({ length: 2048 }),
	templateId: varchar({ length: 50 }).notNull(),
	trackingDomains: jsonb().$type<string[]>(),
	trackingEnabled: boolean().notNull().default(false),
});

export const appAgeRatings = pgTable("app_age_ratings", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,
	appId: uuid()
		.notNull()
		.references(() => apps.id, { onDelete: "cascade" })
		.unique(),
	appleQuestionnaire: jsonb().$type<Record<string, string>>(),
	appleRating: varchar({ length: 50 }),
	googleQuestionnaire: jsonb().$type<Record<string, string | boolean>>(),
	googleRating: varchar({ length: 50 }),
	presetId: varchar({ length: 50 }).notNull(),
});

// ── App Groups ─────────────────────────────────────────────────────

export const appGroups = pgTable(
	"app_groups",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		iconUrl: varchar({ length: 1024 }),
		name: varchar({ length: 255 }).notNull(),
		sortOrder: integer().notNull().default(0),
		useSharedProfile: boolean().notNull().default(false),
		workspaceId: uuid()
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
	},
	(t) => [unique().on(t.workspaceId, t.name)],
);

export const appGroupMembers = pgTable(
	"app_group_members",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		appId: uuid()
			.notNull()
			.references(() => apps.id, { onDelete: "cascade" }),
		groupId: uuid()
			.notNull()
			.references(() => appGroups.id, { onDelete: "cascade" }),
		sortOrder: integer().notNull().default(0),
	},
	(t) => [unique().on(t.groupId, t.appId)],
);

export const groupAsoProfiles = pgTable("group_aso_profiles", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,

	// Social Proof
	awards: jsonb().$type<string[]>(),

	// Tone & Branding
	brandVoiceExample: text(),

	// Core Information
	category: text(),

	// Competitors
	competitiveAdvantage: text(),
	competitors: jsonb().$type<string[]>(),
	differentiator: text(),
	downloadCount: text(),

	// Keywords
	excludeKeywords: jsonb().$type<string[]>(),

	// Product Details
	freeFeatures: jsonb().$type<string[]>(),
	groupId: uuid()
		.notNull()
		.references(() => appGroups.id, { onDelete: "cascade" })
		.unique(),
	keyFeatures: jsonb().$type<string[]>(),
	longTailKeywords: jsonb().$type<string[]>(),
	mainBenefit: text(),
	mustIncludeKeywords: jsonb().$type<string[]>(),
	oneLiner: text(),

	// Audience
	painPoints: jsonb().$type<string[]>(),
	positioning: text(),
	premiumFeatures: jsonb().$type<string[]>(),
	pressQuotes: jsonb().$type<string[]>(),
	price: text(),
	pricingModel: text(),
	problem: text(),
	targetAudience: text(),
	testimonials: jsonb().$type<string[]>(),
	tone: text(),
	userLanguage: text(),
	wordsToAvoid: jsonb().$type<string[]>(),
	wordsToInclude: jsonb().$type<string[]>(),
});

// ── In-App Purchases & Subscriptions ────────────────────────────────

export const subscriptionGroups = pgTable(
	"subscription_groups",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		appId: uuid()
			.notNull()
			.references(() => apps.id, { onDelete: "cascade" }),
		availableTerritories: jsonb().$type<string[]>(),
		externalId: varchar({ length: 255 }).notNull(),
		name: varchar({ length: 255 }).notNull(),
		syncedAt: timestamp(),
	},
	(t) => [unique().on(t.appId, t.externalId)],
);

export const inAppPurchases = pgTable(
	"in_app_purchases",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		appId: uuid()
			.notNull()
			.references(() => apps.id, { onDelete: "cascade" }),
		availableTerritories: jsonb().$type<string[]>(),
		duration: varchar({ length: 50 }),
		externalId: varchar({ length: 255 }).notNull(),
		familySharable: boolean().notNull().default(false),
		groupId: uuid().references(() => subscriptionGroups.id, {
			onDelete: "set null",
		}),
		name: varchar({ length: 255 }).notNull(),
		productId: varchar({ length: 255 }).notNull(),
		productType: varchar({ length: 50 }).notNull(),
		status: varchar({ length: 50 }).notNull().default("approved"),
		syncedAt: timestamp(),
		useGroupLocalizations: boolean().notNull().default(true),
	},
	(t) => [unique().on(t.appId, t.externalId)],
);

export const purchaseLocalizations = pgTable(
	"purchase_localizations",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		description: text(),
		externalId: varchar({ length: 255 }),
		language: varchar({ length: 20 }).notNull(),
		name: varchar({ length: 255 }),
		purchaseId: uuid()
			.notNull()
			.references(() => inAppPurchases.id, { onDelete: "cascade" }),
		syncedAt: timestamp(),
	},
	(t) => [unique().on(t.purchaseId, t.language)],
);

export const purchasePrices = pgTable(
	"purchase_prices",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		currency: varchar({ length: 10 }).notNull(),
		externalId: varchar({ length: 255 }),
		price: varchar({ length: 50 }).notNull(),
		purchaseId: uuid()
			.notNull()
			.references(() => inAppPurchases.id, { onDelete: "cascade" }),
		syncedAt: timestamp(),
		territory: varchar({ length: 10 }).notNull(),
	},
	(t) => [unique().on(t.purchaseId, t.territory)],
);

export const subscriptionGroupLocalizations = pgTable(
	"subscription_group_localizations",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		description: text(),
		externalId: varchar({ length: 255 }),
		groupId: uuid()
			.notNull()
			.references(() => subscriptionGroups.id, { onDelete: "cascade" }),
		language: varchar({ length: 20 }).notNull(),
		name: varchar({ length: 255 }),
	},
	(t) => [unique().on(t.groupId, t.language)],
);

export const subscriptionGroupReviewInfo = pgTable(
	"subscription_group_review_info",
	{
		id: uuid().defaultRandom().primaryKey(),
		...timeColumns,
		groupId: uuid()
			.notNull()
			.references(() => subscriptionGroups.id, { onDelete: "cascade" })
			.unique(),
		reviewNotes: text(),
		screenshotUrl: varchar({ length: 2048 }),
	},
);

// ── AI Chat ─────────────────────────────────────────────────────────

export const aiChatMessages = pgTable("ai_chat_messages", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,
	appId: uuid()
		.notNull()
		.references(() => apps.id, { onDelete: "cascade" }),
	chatType: varchar({ length: 50 }).notNull(),
	content: text().notNull(),
	role: varchar({ length: 20 }).notNull(),
	sortOrder: integer().notNull().default(0),
	workspaceId: uuid()
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
});

export const purchaseReviewInfo = pgTable("purchase_review_info", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,
	purchaseId: uuid()
		.notNull()
		.references(() => inAppPurchases.id, { onDelete: "cascade" })
		.unique(),
	reviewNotes: text(),
	screenshotUrl: varchar({ length: 2048 }),
	useGroupDefault: boolean().notNull().default(true),
});

export const schema = {
	account,
	aiChatMessages,
	appAgeRatings,
	appAiPrompts,
	appAsoProfiles,
	appGroupMembers,
	appGroups,
	appPrivacyDeclarations,
	apps,
	appVersions,
	assets,
	groupAsoProfiles,
	inAppPurchases,
	listingHistory,
	listings,
	purchaseLocalizations,
	purchasePrices,
	purchaseReviewInfo,
	reviews,
	session,
	settings,
	stores,
	subscriptionGroupLocalizations,
	subscriptionGroupReviewInfo,
	subscriptionGroups,
	user,
	verification,
	versionLocalizations,
	workspaceMembers,
	workspaces,
};

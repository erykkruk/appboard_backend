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

export const stores = pgTable("stores", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,
	credentials: text(),
	lastSyncedAt: timestamp(),
	name: varchar({ length: 255 }).notNull(),
	status: varchar({ length: 50 }).notNull().default("disconnected"),
	type: varchar({ length: 50 }).notNull(),
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
	rawData: jsonb(),
	status: varchar({ length: 50 }).notNull().default("active"),
	storeId: uuid()
		.notNull()
		.references(() => stores.id, { onDelete: "cascade" }),
});

export const settings = pgTable("settings", {
	id: uuid().defaultRandom().primaryKey(),
	...timeColumns,
	isEncrypted: boolean().notNull().default(false),
	key: varchar({ length: 255 }).notNull().unique(),
	value: text(),
});

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

	// Core Information
	category: text(),
	differentiator: text(),
	keyFeatures: jsonb().$type<string[]>(),
	mainBenefit: text(),
	oneLiner: text(),
	problem: text(),

	// Tone & Branding
	brandVoiceExample: text(),
	tone: text(),
	wordsToAvoid: jsonb().$type<string[]>(),
	wordsToInclude: jsonb().$type<string[]>(),

	// Competitors
	competitiveAdvantage: text(),
	competitors: jsonb().$type<string[]>(),
	positioning: text(),

	// Social Proof
	awards: jsonb().$type<string[]>(),
	downloadCount: text(),
	pressQuotes: jsonb().$type<string[]>(),
	testimonials: jsonb().$type<string[]>(),

	// Product Details
	freeFeatures: jsonb().$type<string[]>(),
	premiumFeatures: jsonb().$type<string[]>(),
	price: text(),
	pricingModel: text(),

	// Audience
	painPoints: jsonb().$type<string[]>(),
	targetAudience: text(),
	userLanguage: text(),

	// Keywords
	excludeKeywords: jsonb().$type<string[]>(),
	longTailKeywords: jsonb().$type<string[]>(),
	mustIncludeKeywords: jsonb().$type<string[]>(),
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

export const schema = {
	appAsoProfiles,
	apps,
	appVersions,
	assets,
	listingHistory,
	listings,
	reviews,
	settings,
	stores,
	versionLocalizations,
};

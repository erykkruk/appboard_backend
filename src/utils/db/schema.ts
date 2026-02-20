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
	fileSize: integer(),
	height: integer(),
	language: varchar({ length: 20 }).notNull(),
	sortOrder: integer().notNull().default(0),
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

export const schema = {
	apps,
	assets,
	listingHistory,
	listings,
	reviews,
	settings,
	stores,
};

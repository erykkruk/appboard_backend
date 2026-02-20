import { relations } from "drizzle-orm";
import {
	apps,
	assets,
	listingHistory,
	listings,
	reviews,
	stores,
} from "./schema";

export const storesRelations = relations(stores, ({ many }) => ({
	apps: many(apps),
}));

export const appsRelations = relations(apps, ({ many, one }) => ({
	assets: many(assets),
	listingHistory: many(listingHistory),
	listings: many(listings),
	reviews: many(reviews),
	store: one(stores, {
		fields: [apps.storeId],
		references: [stores.id],
	}),
}));

export const listingsRelations = relations(listings, ({ many, one }) => ({
	app: one(apps, {
		fields: [listings.appId],
		references: [apps.id],
	}),
	history: many(listingHistory),
}));

export const listingHistoryRelations = relations(listingHistory, ({ one }) => ({
	app: one(apps, {
		fields: [listingHistory.appId],
		references: [apps.id],
	}),
	listing: one(listings, {
		fields: [listingHistory.listingId],
		references: [listings.id],
	}),
}));

export const assetsRelations = relations(assets, ({ one }) => ({
	app: one(apps, {
		fields: [assets.appId],
		references: [apps.id],
	}),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
	app: one(apps, {
		fields: [reviews.appId],
		references: [apps.id],
	}),
}));

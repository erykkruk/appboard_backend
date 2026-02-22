import { relations } from "drizzle-orm";
import {
	appAsoProfiles,
	apps,
	appVersions,
	assets,
	listingHistory,
	listings,
	reviews,
	stores,
	versionLocalizations,
} from "./schema";

export const storesRelations = relations(stores, ({ many }) => ({
	apps: many(apps),
}));

export const appsRelations = relations(apps, ({ many, one }) => ({
	asoProfile: one(appAsoProfiles, {
		fields: [apps.id],
		references: [appAsoProfiles.appId],
	}),
	assets: many(assets),
	listingHistory: many(listingHistory),
	listings: many(listings),
	reviews: many(reviews),
	store: one(stores, {
		fields: [apps.storeId],
		references: [stores.id],
	}),
	versions: many(appVersions),
}));

export const appAsoProfilesRelations = relations(appAsoProfiles, ({ one }) => ({
	app: one(apps, {
		fields: [appAsoProfiles.appId],
		references: [apps.id],
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

export const appVersionsRelations = relations(appVersions, ({ many, one }) => ({
	app: one(apps, {
		fields: [appVersions.appId],
		references: [apps.id],
	}),
	localizations: many(versionLocalizations),
}));

export const versionLocalizationsRelations = relations(
	versionLocalizations,
	({ one }) => ({
		app: one(apps, {
			fields: [versionLocalizations.appId],
			references: [apps.id],
		}),
		version: one(appVersions, {
			fields: [versionLocalizations.versionId],
			references: [appVersions.id],
		}),
	}),
);

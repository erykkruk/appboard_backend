import { relations } from "drizzle-orm";
import {
	account,
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
	reviews,
	session,
	settings,
	stores,
	subscriptionGroups,
	user,
	versionLocalizations,
	workspaceMembers,
	workspaces,
} from "./schema";

// ── Auth relations ──────────────────────────────────────────────────

export const userRelations = relations(user, ({ many }) => ({
	accounts: many(account),
	sessions: many(session),
	workspaceMemberships: many(workspaceMembers),
}));

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id],
	}),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id],
	}),
}));

// ── Workspace relations ─────────────────────────────────────────────

export const workspacesRelations = relations(workspaces, ({ many }) => ({
	appGroups: many(appGroups),
	members: many(workspaceMembers),
	settings: many(settings),
	stores: many(stores),
}));

export const workspaceMembersRelations = relations(
	workspaceMembers,
	({ one }) => ({
		user: one(user, {
			fields: [workspaceMembers.userId],
			references: [user.id],
		}),
		workspace: one(workspaces, {
			fields: [workspaceMembers.workspaceId],
			references: [workspaces.id],
		}),
	}),
);

// ── Domain relations ────────────────────────────────────────────────

export const storesRelations = relations(stores, ({ many, one }) => ({
	apps: many(apps),
	workspace: one(workspaces, {
		fields: [stores.workspaceId],
		references: [workspaces.id],
	}),
}));

export const settingsRelations = relations(settings, ({ one }) => ({
	workspace: one(workspaces, {
		fields: [settings.workspaceId],
		references: [workspaces.id],
	}),
}));

export const appsRelations = relations(apps, ({ many, one }) => ({
	ageRating: one(appAgeRatings, {
		fields: [apps.id],
		references: [appAgeRatings.appId],
	}),
	aiPrompts: many(appAiPrompts),
	asoProfile: one(appAsoProfiles, {
		fields: [apps.id],
		references: [appAsoProfiles.appId],
	}),
	assets: many(assets),
	groupMemberships: many(appGroupMembers),
	inAppPurchases: many(inAppPurchases),
	listingHistory: many(listingHistory),
	listings: many(listings),
	privacyDeclaration: one(appPrivacyDeclarations, {
		fields: [apps.id],
		references: [appPrivacyDeclarations.appId],
	}),
	reviews: many(reviews),
	store: one(stores, {
		fields: [apps.storeId],
		references: [stores.id],
	}),
	subscriptionGroups: many(subscriptionGroups),
	versions: many(appVersions),
}));

export const appAiPromptsRelations = relations(appAiPrompts, ({ one }) => ({
	app: one(apps, {
		fields: [appAiPrompts.appId],
		references: [apps.id],
	}),
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

export const appPrivacyDeclarationsRelations = relations(
	appPrivacyDeclarations,
	({ one }) => ({
		app: one(apps, {
			fields: [appPrivacyDeclarations.appId],
			references: [apps.id],
		}),
	}),
);

export const appAgeRatingsRelations = relations(appAgeRatings, ({ one }) => ({
	app: one(apps, {
		fields: [appAgeRatings.appId],
		references: [apps.id],
	}),
}));

// ── App Group relations ────────────────────────────────────────────

export const appGroupsRelations = relations(appGroups, ({ many, one }) => ({
	asoProfile: one(groupAsoProfiles, {
		fields: [appGroups.id],
		references: [groupAsoProfiles.groupId],
	}),
	members: many(appGroupMembers),
	workspace: one(workspaces, {
		fields: [appGroups.workspaceId],
		references: [workspaces.id],
	}),
}));

export const groupAsoProfilesRelations = relations(
	groupAsoProfiles,
	({ one }) => ({
		group: one(appGroups, {
			fields: [groupAsoProfiles.groupId],
			references: [appGroups.id],
		}),
	}),
);

export const appGroupMembersRelations = relations(
	appGroupMembers,
	({ one }) => ({
		app: one(apps, {
			fields: [appGroupMembers.appId],
			references: [apps.id],
		}),
		group: one(appGroups, {
			fields: [appGroupMembers.groupId],
			references: [appGroups.id],
		}),
	}),
);

// ── In-App Purchases & Subscriptions relations ────────────────────

export const subscriptionGroupsRelations = relations(
	subscriptionGroups,
	({ many, one }) => ({
		app: one(apps, {
			fields: [subscriptionGroups.appId],
			references: [apps.id],
		}),
		purchases: many(inAppPurchases),
	}),
);

export const inAppPurchasesRelations = relations(
	inAppPurchases,
	({ many, one }) => ({
		app: one(apps, {
			fields: [inAppPurchases.appId],
			references: [apps.id],
		}),
		group: one(subscriptionGroups, {
			fields: [inAppPurchases.groupId],
			references: [subscriptionGroups.id],
		}),
		localizations: many(purchaseLocalizations),
		prices: many(purchasePrices),
	}),
);

export const purchaseLocalizationsRelations = relations(
	purchaseLocalizations,
	({ one }) => ({
		purchase: one(inAppPurchases, {
			fields: [purchaseLocalizations.purchaseId],
			references: [inAppPurchases.id],
		}),
	}),
);

export const purchasePricesRelations = relations(purchasePrices, ({ one }) => ({
	purchase: one(inAppPurchases, {
		fields: [purchasePrices.purchaseId],
		references: [inAppPurchases.id],
	}),
}));

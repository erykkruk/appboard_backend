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
	listingHistory,
	listings,
	reviews,
	session,
	settings,
	stores,
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
	members: many(appGroupMembers),
	workspace: one(workspaces, {
		fields: [appGroups.workspaceId],
		references: [workspaces.id],
	}),
}));

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

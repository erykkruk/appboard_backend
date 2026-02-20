import { relations } from "drizzle-orm";
import { apps, stores } from "./schema";

export const storesRelations = relations(stores, ({ many }) => ({
	apps: many(apps),
}));

export const appsRelations = relations(apps, ({ one }) => ({
	store: one(stores, {
		fields: [apps.storeId],
		references: [stores.id],
	}),
}));

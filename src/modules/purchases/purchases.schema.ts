import { t } from "elysia";

export const appIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

export const purchaseIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
	purchaseId: t.String({ format: "uuid" }),
});

export const groupIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
	groupId: t.String({ format: "uuid" }),
});

export const subscriptionInGroupParams = t.Object({
	appId: t.String({ format: "uuid" }),
	groupId: t.String({ format: "uuid" }),
});

const localizationSchema = t.Object({
	description: t.Optional(t.String()),
	language: t.String(),
	name: t.Optional(t.String()),
});

const priceSchema = t.Object({
	currency: t.String(),
	price: t.String(),
	territory: t.String(),
});

export const createPurchaseBody = t.Object({
	localizations: t.Optional(t.Array(localizationSchema)),
	name: t.String({ minLength: 1 }),
	prices: t.Optional(t.Array(priceSchema)),
	productId: t.String({ minLength: 1 }),
	productType: t.String({ minLength: 1 }),
});

export const updatePurchaseBody = t.Object({
	localizations: t.Optional(t.Array(localizationSchema)),
	name: t.Optional(t.String({ minLength: 1 })),
	prices: t.Optional(t.Array(priceSchema)),
});

export const createGroupBody = t.Object({
	name: t.String({ minLength: 1 }),
});

export const updateGroupBody = t.Object({
	name: t.Optional(t.String({ minLength: 1 })),
});

export const createSubscriptionBody = t.Object({
	duration: t.String({ minLength: 1 }),
	localizations: t.Optional(t.Array(localizationSchema)),
	name: t.String({ minLength: 1 }),
	prices: t.Optional(t.Array(priceSchema)),
	productId: t.String({ minLength: 1 }),
});

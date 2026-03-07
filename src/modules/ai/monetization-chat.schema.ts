import { t } from "elysia";

const priceSchema = t.Object({
	currency: t.String(),
	price: t.String(),
	territory: t.String(),
});

const chatMessageSchema = t.Object({
	content: t.String({ minLength: 1 }),
	role: t.Union([t.Literal("user"), t.Literal("assistant")]),
});

export const monetizationChatBody = t.Object({
	appId: t.String({ format: "uuid" }),
	messages: t.Array(chatMessageSchema, { minItems: 1 }),
	territories: t.Optional(t.Array(t.String({ maxLength: 3, minLength: 2 }))),
});

const planGroupSchema = t.Object({
	id: t.Optional(t.String({ format: "uuid" })),
	name: t.Optional(t.String({ minLength: 1 })),
	subscriptions: t.Array(
		t.Object({
			duration: t.String({ minLength: 1 }),
			localizations: t.Optional(
				t.Array(
					t.Object({
						description: t.Optional(t.String()),
						language: t.String(),
						name: t.Optional(t.String()),
					}),
				),
			),
			name: t.String({ minLength: 1 }),
			prices: t.Optional(t.Array(priceSchema)),
			productId: t.String({ minLength: 1 }),
		}),
	),
});

const planPurchaseSchema = t.Object({
	localizations: t.Optional(
		t.Array(
			t.Object({
				description: t.Optional(t.String()),
				language: t.String(),
				name: t.Optional(t.String()),
			}),
		),
	),
	name: t.String({ minLength: 1 }),
	prices: t.Optional(t.Array(priceSchema)),
	productId: t.String({ minLength: 1 }),
	productType: t.String({ minLength: 1 }),
});

const planEditSchema = t.Object({
	localizations: t.Optional(
		t.Array(
			t.Object({
				description: t.Optional(t.String()),
				language: t.String(),
				name: t.Optional(t.String()),
			}),
		),
	),
	name: t.Optional(t.String({ minLength: 1 })),
	prices: t.Optional(t.Array(priceSchema)),
	purchaseId: t.String({ format: "uuid" }),
});

const planGroupEditSchema = t.Object({
	groupId: t.String({ format: "uuid" }),
	name: t.Optional(t.String({ minLength: 1 })),
});

export const monetizationExecuteBody = t.Object({
	appId: t.String({ format: "uuid" }),
	plan: t.Object({
		deletes: t.Optional(t.Array(t.String({ format: "uuid" }))),
		edits: t.Optional(t.Array(planEditSchema)),
		groupEdits: t.Optional(t.Array(planGroupEditSchema)),
		groups: t.Optional(t.Array(planGroupSchema)),
		purchases: t.Optional(t.Array(planPurchaseSchema)),
	}),
});

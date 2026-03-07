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
	id: t.Optional(t.String()),
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
	purchaseId: t.String(),
});

const planGroupEditSchema = t.Object({
	groupId: t.String(),
	name: t.Optional(t.String({ minLength: 1 })),
});

export const quickActionBody = t.Object({
	appId: t.String({ format: "uuid" }),
	focusContext: t.Optional(
		t.Object({
			duration: t.Optional(t.String()),
			groupName: t.Optional(t.String()),
			id: t.String({ format: "uuid" }),
			localizations: t.Optional(
				t.Array(
					t.Object({
						description: t.Optional(t.String()),
						language: t.String(),
						name: t.Optional(t.String()),
					}),
				),
			),
			name: t.String(),
			prices: t.Optional(t.Array(priceSchema)),
			productId: t.Optional(t.String()),
			productType: t.Optional(t.String()),
			type: t.Union([t.Literal("purchase"), t.Literal("group")]),
		}),
	),
	instruction: t.String({ minLength: 1 }),
	territories: t.Optional(t.Array(t.String({ maxLength: 3, minLength: 2 }))),
});

export const monetizationExecuteBody = t.Object({
	appId: t.String({ format: "uuid" }),
	plan: t.Object({
		deletes: t.Optional(t.Array(t.String())),
		edits: t.Optional(t.Array(planEditSchema)),
		groupDeletes: t.Optional(t.Array(t.String())),
		groupEdits: t.Optional(t.Array(planGroupEditSchema)),
		groups: t.Optional(t.Array(planGroupSchema)),
		purchases: t.Optional(t.Array(planPurchaseSchema)),
	}),
});

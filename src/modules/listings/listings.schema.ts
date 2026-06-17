import { t } from "elysia";

export const listingParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

export const listingLanguageParams = t.Object({
	appId: t.String({ format: "uuid" }),
	language: t.String({ minLength: 2 }),
});

export const exportQuery = t.Object({
	format: t.Union([t.Literal("csv"), t.Literal("json")]),
});

export const updateListingBody = t.Object({
	doNotTranslateFields: t.Optional(t.Array(t.String())),
	fullDesc: t.Optional(t.String()),
	keywords: t.Optional(t.String({ maxLength: 255 })),
	marketingUrl: t.Optional(t.String({ maxLength: 1024 })),
	privacyUrl: t.Optional(t.String({ maxLength: 1024 })),
	promoText: t.Optional(t.String({ maxLength: 255 })),
	shortDesc: t.Optional(t.String({ maxLength: 255 })),
	supportUrl: t.Optional(t.String({ maxLength: 1024 })),
	title: t.Optional(t.String({ maxLength: 255 })),
	translationInstructions: t.Optional(t.String()),
	videoUrl: t.Optional(t.String({ maxLength: 1024 })),
	whatsNew: t.Optional(t.String()),
});

export const updateCategoriesBody = t.Object({
	primaryCategory: t.String({ maxLength: 100, minLength: 1 }),
	secondaryCategory: t.Optional(t.String({ maxLength: 100 })),
});

export const translateFieldBody = t.Object({
	field: t.Union([
		t.Literal("title"),
		t.Literal("subtitle"),
		t.Literal("shortDescription"),
		t.Literal("description"),
		t.Literal("keywords"),
		t.Literal("promotionalText"),
		t.Literal("whatsNew"),
	]),
});

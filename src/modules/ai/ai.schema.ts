import { t } from "elysia";

export const translateBody = t.Object({
	targetLanguages: t.Array(t.String({ minLength: 2 })),
	text: t.String({ minLength: 1 }),
});

export const generateDescriptionBody = t.Object({
	appName: t.String({ minLength: 1 }),
	keywords: t.Optional(t.Array(t.String())),
	platform: t.Optional(t.String()),
	prompt: t.String({ minLength: 1 }),
});

export const suggestKeywordsBody = t.Object({
	appName: t.String({ minLength: 1 }),
	category: t.Optional(t.String()),
	currentKeywords: t.Optional(t.Array(t.String())),
	description: t.Optional(t.String()),
});

export const draftReplyBody = t.Object({
	authorName: t.String(),
	rating: t.Number({ maximum: 5, minimum: 1 }),
	reviewText: t.String({ minLength: 1 }),
	tone: t.Optional(t.String()),
});

export const generateReleaseNotesBody = t.Object({
	appName: t.String({ minLength: 1 }),
	changes: t.Array(t.String({ minLength: 1 })),
	version: t.String({ minLength: 1 }),
});

export const generatePrivacyBody = t.Object({
	appName: t.String({ minLength: 1 }),
	description: t.String({ minLength: 10 }),
});

export const suggestCategoryBody = t.Object({
	appId: t.String({ minLength: 1 }),
	appName: t.String({ minLength: 1 }),
	description: t.Optional(t.String()),
	platform: t.String({ minLength: 1 }),
});

export const generateListingFieldBody = t.Object({
	appId: t.String({ minLength: 1 }),
	appName: t.String({ minLength: 1 }),
	currentValue: t.Optional(t.String()),
	field: t.Union([
		t.Literal("title"),
		t.Literal("subtitle"),
		t.Literal("shortDescription"),
		t.Literal("description"),
		t.Literal("keywords"),
		t.Literal("promotionalText"),
		t.Literal("whatsNew"),
	]),
	language: t.String({ minLength: 1 }),
	platform: t.String({ minLength: 1 }),
});

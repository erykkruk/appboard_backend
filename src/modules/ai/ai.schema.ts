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

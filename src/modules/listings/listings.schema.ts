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
	fullDesc: t.Optional(t.String()),
	keywords: t.Optional(t.String({ maxLength: 255 })),
	marketingUrl: t.Optional(t.String({ maxLength: 1024 })),
	privacyUrl: t.Optional(t.String({ maxLength: 1024 })),
	promoText: t.Optional(t.String({ maxLength: 255 })),
	shortDesc: t.Optional(t.String({ maxLength: 255 })),
	supportUrl: t.Optional(t.String({ maxLength: 1024 })),
	title: t.Optional(t.String({ maxLength: 255 })),
	whatsNew: t.Optional(t.String()),
});

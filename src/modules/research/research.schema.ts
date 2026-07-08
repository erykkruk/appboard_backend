import { t } from "elysia";

const store = t.Union([t.Literal("appstore"), t.Literal("playstore")]);

const country = t.String({ maxLength: 2, minLength: 2 });

const appMeta = t.Object(
	{
		adSupported: t.Optional(t.Boolean()),
		contentRating: t.Optional(t.String()),
		country: t.String(),
		description: t.Optional(t.String()),
		developer: t.String(),
		downloads: t.Optional(t.String()),
		free: t.Optional(t.Boolean()),
		genre: t.Optional(t.String()),
		iapRange: t.Optional(t.String()),
		icon: t.Optional(t.String()),
		id: t.String(),
		lastUpdate: t.Optional(t.String()),
		minInstalls: t.Optional(t.Number()),
		offersIAP: t.Optional(t.Boolean()),
		price: t.Optional(t.String()),
		rating: t.Optional(t.Number()),
		ratingsCount: t.Optional(t.Number()),
		released: t.Optional(t.String()),
		reviewsCount: t.Optional(t.Number()),
		screenshots: t.Optional(t.Array(t.String())),
		store,
		summary: t.Optional(t.String()),
		title: t.String(),
		url: t.String(),
		version: t.Optional(t.String()),
	},
	{ additionalProperties: false },
);

const review = t.Object(
	{
		date: t.Optional(t.String()),
		stars: t.Number({ maximum: 5, minimum: 0 }),
		store,
		text: t.String(),
		title: t.Optional(t.String()),
		version: t.Optional(t.String()),
	},
	{ additionalProperties: false },
);

export const searchBody = t.Object({
	country: country,
	scope: t.Optional(
		t.Union([t.Literal("both"), t.Literal("appstore"), t.Literal("playstore")]),
	),
	term: t.String({ minLength: 1 }),
});

export const scrapeBody = t.Object({
	country: t.Optional(country),
	deep: t.Optional(t.Boolean()),
	id: t.Optional(t.String({ minLength: 1 })),
	store: t.Optional(store),
	url: t.Optional(t.String({ minLength: 1 })),
});

export const analyzeBody = t.Object({
	deep: t.Optional(t.Boolean()),
	meta: t.Array(appMeta, { minItems: 1 }),
	model: t.Optional(t.String()),
	reviews: t.Array(review, { minItems: 1 }),
});

export const keywordsBody = t.Object({
	appstoreId: t.Optional(t.String()),
	country: country,
	keywords: t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
	playstoreId: t.Optional(t.String()),
});

export const marketsBody = t.Object({
	id: t.String({ minLength: 1 }),
	markets: t.Optional(t.Array(country)),
	store,
});

export const visualBody = t.Object({
	meta: appMeta,
	model: t.Optional(t.String()),
});

export const competitorsBody = t.Object({
	country: country,
	developer: t.Optional(t.String()),
	genre: t.Optional(t.String()),
	id: t.String({ minLength: 1 }),
	store,
	title: t.String({ minLength: 1 }),
});

export const compareBody = t.Object({
	competitor: t.Object({ id: t.String({ minLength: 1 }), store }),
	country: country,
	model: t.Optional(t.String()),
	ourMeta: appMeta,
	ourReviews: t.Array(review),
});

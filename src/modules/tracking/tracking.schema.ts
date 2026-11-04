import { t } from "elysia";
import { MARKET_HISTORY_MAX_DAYS } from "./tracking.types";

const country = t.String({ maxLength: 2, minLength: 2 });

export const appIdParams = t.Object({ appId: t.String() });

export const keywordParams = t.Object({
	appId: t.String(),
	keywordId: t.String(),
});

export const runParams = t.Object({
	appId: t.String(),
	runId: t.String(),
});

export const checkRunParams = t.Object({
	appId: t.String(),
	runId: t.String({ format: "uuid" }),
});

/** Enough for ~700 phrases over 68 markets in one call, with headroom. */
const MAX_BULK_MARKETS = 250;
const MAX_BULK_KEYWORDS_PER_MARKET = 100;
const MAX_KEYWORD_LENGTH = 255;

export const bulkAddKeywordsBody = t.Object({
	items: t.Array(
		t.Object({
			country: t.String({ pattern: "^[A-Za-z]{2}$" }),
			keywords: t.Array(
				t.String({ maxLength: MAX_KEYWORD_LENGTH, minLength: 1 }),
				{ maxItems: MAX_BULK_KEYWORDS_PER_MARKET, minItems: 1 },
			),
		}),
		{ maxItems: MAX_BULK_MARKETS, minItems: 1 },
	),
});

export const starKeywordParams = t.Object({
	appId: t.String(),
	keywordId: t.String({ format: "uuid" }),
});

export const starKeywordBody = t.Object({ starred: t.Boolean() });

export const bulkStarKeywordsBody = t.Object({
	items: bulkAddKeywordsBody.properties.items,
	starred: t.Boolean(),
});

export const configPatchBody = t.Object({
	autoResearchEnabled: t.Optional(t.Boolean()),
	autoResearchFrequency: t.Optional(
		t.Union([t.Literal("daily"), t.Literal("weekly"), t.Literal("monthly")]),
	),
	emailRankDigest: t.Optional(t.Boolean()),
	notifyEmail: t.Optional(t.Union([t.String(), t.Null()])),
	rankTrackingEnabled: t.Optional(t.Boolean()),
});

export const addKeywordsBody = t.Object({
	country: country,
	keywords: t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
});

export const boardQuery = t.Object({
	country: t.Optional(country),
});

export const suggestionsQuery = t.Object({
	country,
});

export const marketsHistoryQuery = t.Object({
	days: t.Optional(
		t.Numeric({
			maximum: MARKET_HISTORY_MAX_DAYS,
			minimum: 1,
		}),
	),
});

export const historyQuery = t.Object({
	country: t.Optional(t.String()),
	keyword: t.Optional(t.String()),
});

export const runForAppBody = t.Object({
	country: country,
	deep: t.Optional(t.Boolean()),
	keywords: t.Optional(t.Array(t.String())),
});

import { t } from "elysia";

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

export const historyQuery = t.Object({
	country: t.Optional(t.String()),
	keyword: t.Optional(t.String()),
});

export const runForAppBody = t.Object({
	country: country,
	deep: t.Optional(t.Boolean()),
	keywords: t.Optional(t.Array(t.String())),
});

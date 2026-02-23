import { t } from "elysia";

export const ageRatingParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

export const upsertAgeRatingBody = t.Object({
	appleQuestionnaire: t.Optional(t.Record(t.String(), t.String())),
	googleQuestionnaire: t.Optional(
		t.Record(t.String(), t.Union([t.String(), t.Boolean()])),
	),
	presetId: t.String(),
});

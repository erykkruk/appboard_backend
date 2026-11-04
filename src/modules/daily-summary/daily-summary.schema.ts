import { t } from "elysia";

const MAX_EMAIL_LENGTH = 255;

export const dailySummaryPatchBody = t.Object({
	/** Null or "" = fall back to the per-app report email, then the owner. */
	email: t.Optional(
		t.Union([
			t.String({ format: "email", maxLength: MAX_EMAIL_LENGTH }),
			t.Literal(""),
			t.Null(),
		]),
	),
	enabled: t.Optional(t.Boolean()),
});

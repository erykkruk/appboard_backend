import { t } from "elysia";

// Multipart/form-data — text fields plus optional file attachments.
export const feedbackBody = t.Object({
	email: t.String({ format: "email" }),
	feature: t.String({ maxLength: 100, minLength: 1 }),
	files: t.Optional(t.Files()),
	message: t.String({ maxLength: 5000, minLength: 1 }),
	// Free-text detail shown when the user picks "Other" in the feature dropdown.
	otherText: t.Optional(t.String({ maxLength: 200 })),
});

import { t } from "elysia";

export const privacyDeclarationParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

const dataCollectionItem = t.Object({
	category: t.String(),
	dataType: t.String(),
	linked: t.Boolean(),
	purposes: t.Array(t.String()),
	tracking: t.Boolean(),
});

export const upsertPrivacyDeclarationBody = t.Object({
	dataCollections: t.Optional(t.Array(dataCollectionItem)),
	privacyPolicyUrl: t.Optional(t.Union([t.String(), t.Null()])),
	templateId: t.String(),
	trackingDomains: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
	trackingEnabled: t.Optional(t.Boolean()),
});

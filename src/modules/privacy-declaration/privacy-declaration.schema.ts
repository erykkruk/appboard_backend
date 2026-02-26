import { t } from "elysia";

export const privacyDeclarationParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

const dataCollectionItem = t.Object({
	category: t.String(),
	collected: t.Optional(t.Boolean()),
	dataType: t.String(),
	ephemeral: t.Optional(t.Boolean()),
	linked: t.Boolean(),
	purposes: t.Array(t.String()),
	required: t.Optional(t.Boolean()),
	shared: t.Optional(t.Boolean()),
	tracking: t.Boolean(),
});

export const upsertPrivacyDeclarationBody = t.Object({
	dataCollections: t.Optional(t.Array(dataCollectionItem)),
	gpDeletionMechanism: t.Optional(t.Boolean()),
	gpEncryptedInTransit: t.Optional(t.Boolean()),
	privacyPolicyUrl: t.Optional(t.Union([t.String(), t.Null()])),
	templateId: t.String(),
	trackingDomains: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
	trackingEnabled: t.Optional(t.Boolean()),
});

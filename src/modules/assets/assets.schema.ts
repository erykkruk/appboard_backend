import { t } from "elysia";

export const assetParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

export const assetIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
	assetId: t.String({ format: "uuid" }),
});

export const assetQuery = t.Object({
	assetType: t.Optional(t.String()),
	deviceType: t.Optional(t.String()),
	language: t.Optional(t.String()),
});

export const reorderBody = t.Array(
	t.Object({
		id: t.String({ format: "uuid" }),
		sortOrder: t.Number({ minimum: 0 }),
	}),
);

export const uploadAssetBody = t.Object({
	assetType: t.String({ minLength: 1 }),
	deviceType: t.String({ minLength: 1 }),
	language: t.String({ minLength: 2 }),
});

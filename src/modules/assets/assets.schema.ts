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

export const reorderBody = t.Object({
	assetIds: t.Array(t.String({ format: "uuid" })),
});

export const uploadAssetBody = t.Object({
	assetType: t.String({ minLength: 1 }),
	deviceType: t.String({ minLength: 1 }),
	file: t.File({ type: "image" }),
	language: t.String({ minLength: 2 }),
});

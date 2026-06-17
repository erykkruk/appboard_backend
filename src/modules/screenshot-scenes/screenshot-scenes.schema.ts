import { t } from "elysia";

export const sceneParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

export const sceneIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
	sceneId: t.String({ format: "uuid" }),
});

// The inner `scene` object is owned by the frontend editor and stored intact —
// validate only that it is an object, never its internal shape.
const sceneObject = t.Object({}, { additionalProperties: true });

export const createSceneBody = t.Object({
	displayType: t.String({ maxLength: 50, minLength: 1 }),
	language: t.String({ maxLength: 20, minLength: 2 }),
	name: t.String({ maxLength: 255, minLength: 1 }),
	scene: sceneObject,
	sortOrder: t.Optional(t.Integer({ minimum: 0 })),
});

export const updateSceneBody = t.Object({
	assetId: t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()])),
	name: t.Optional(t.String({ maxLength: 255, minLength: 1 })),
	scene: t.Optional(sceneObject),
	sortOrder: t.Optional(t.Integer({ minimum: 0 })),
});

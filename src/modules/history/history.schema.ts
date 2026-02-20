import { t } from "elysia";

export const historyParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

export const historyQuery = t.Object({
	field: t.Optional(t.String()),
	language: t.Optional(t.String()),
});

export const rollbackParams = t.Object({
	appId: t.String({ format: "uuid" }),
	historyId: t.String({ format: "uuid" }),
});

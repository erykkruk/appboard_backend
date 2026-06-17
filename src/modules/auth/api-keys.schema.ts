import { t } from "elysia";

export const createApiKeyBody = t.Object({
	name: t.String({ maxLength: 255, minLength: 1 }),
});

export const apiKeyIdParams = t.Object({
	id: t.String({ format: "uuid" }),
});

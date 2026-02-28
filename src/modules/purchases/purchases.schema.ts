import { t } from "elysia";

export const appIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

export const purchaseIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
	purchaseId: t.String({ format: "uuid" }),
});

export const groupIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
	groupId: t.String({ format: "uuid" }),
});

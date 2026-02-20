import { t } from "elysia";
import { PLATFORMS } from "@/config/const";
import { unionEnum } from "@/utils/helpers";

export const appsQuery = t.Object({
	platform: t.Optional(unionEnum(PLATFORMS)),
	storeId: t.Optional(t.String({ format: "uuid" })),
});

export const appIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

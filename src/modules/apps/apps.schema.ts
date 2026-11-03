import { t } from "elysia";
import { APP_DEVICES, PLATFORMS } from "@/config/const";
import { unionEnum } from "@/utils/helpers";

export const appsQuery = t.Object({
	platform: t.Optional(unionEnum(PLATFORMS)),
	storeId: t.Optional(t.String({ format: "uuid" })),
});

export const appIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

// t.UnionEnum (not the unionEnum helper) so Eden clients see the literals.
export const devicesSchema = t.Array(t.UnionEnum(APP_DEVICES), {
	maxItems: APP_DEVICES.length,
	minItems: 1,
});

export const updateAppBody = t.Object({
	devices: devicesSchema,
});

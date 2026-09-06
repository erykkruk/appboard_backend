import { t } from "elysia";
import { PLATFORMS, STORE_TYPES } from "@/config/const";
import { unionEnum } from "@/utils/helpers";

export const connectStoreBody = t.Object({
	capabilities: t.Optional(t.Array(t.String())),
	credentials: t.Record(t.String(), t.Unknown()),
	name: t.String({ minLength: 1 }),
	type: unionEnum(STORE_TYPES),
});

export const storeCapabilitiesBody = t.Object({
	capabilities: t.Array(t.String()),
});

// Import an app from a public store link: either `url`, or `platform` +
// `externalId` (Apple numeric id / Android package name) from a typeahead.
export const importAppBody = t.Object({
	country: t.Optional(t.String({ maxLength: 2, minLength: 2 })),
	externalId: t.Optional(t.String({ maxLength: 255, minLength: 1 })),
	platform: t.Optional(unionEnum(PLATFORMS)),
	url: t.Optional(t.String({ maxLength: 2048, minLength: 1 })),
});

export const verifyAccessBody = t.Object({
	credentials: t.Record(t.String(), t.Unknown()),
	type: unionEnum(STORE_TYPES),
});

export const renameStoreBody = t.Object({
	name: t.String({ maxLength: 255, minLength: 1 }),
});

export const addPackageBody = t.Object({
	packageName: t.String({
		minLength: 3,
		pattern: "^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$",
	}),
});

export const storeIdParams = t.Object({
	storeId: t.String({ format: "uuid" }),
});

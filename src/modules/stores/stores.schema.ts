import { t } from "elysia";
import { STORE_TYPES } from "@/config/const";
import { unionEnum } from "@/utils/helpers";

export const connectStoreBody = t.Object({
	credentials: t.Record(t.String(), t.Unknown()),
	name: t.String({ minLength: 1 }),
	type: unionEnum(STORE_TYPES),
});

export const storeIdParams = t.Object({
	storeId: t.String({ format: "uuid" }),
});

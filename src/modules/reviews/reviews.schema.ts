import { t } from "elysia";
import { STORE_TYPES } from "@/config/const";
import { unionEnum } from "@/utils/helpers";

export const reviewsParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

export const reviewIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
	reviewId: t.String({ format: "uuid" }),
});

export const reviewsQuery = t.Object({
	hasReply: t.Optional(t.BooleanString()),
	language: t.Optional(t.String()),
	rating: t.Optional(t.Numeric({ maximum: 5, minimum: 1 })),
	storeType: t.Optional(unionEnum(STORE_TYPES)),
});

export const replyBody = t.Object({
	text: t.String({ minLength: 1 }),
});

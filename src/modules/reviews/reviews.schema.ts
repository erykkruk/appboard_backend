import { t } from "elysia";
import { STORE_TYPES } from "@/config/const";
import { unionEnum } from "@/utils/helpers";
import { RATING_SCOPES } from "./ratings.types";

export const reviewsParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

export const reviewIdParams = t.Object({
	appId: t.String({ format: "uuid" }),
	reviewId: t.String({ format: "uuid" }),
});

const scopeQuery = t.Optional(unionEnum(RATING_SCOPES));

export const scopeOnlyQuery = t.Object({
	scope: scopeQuery,
});

export const reviewsQuery = t.Object({
	country: t.Optional(t.String({ maxLength: 2, minLength: 2 })),
	hasReply: t.Optional(t.BooleanString()),
	language: t.Optional(t.String()),
	rating: t.Optional(t.Numeric({ maximum: 5, minimum: 1 })),
	scope: scopeQuery,
	storeType: t.Optional(unionEnum(STORE_TYPES)),
});

export const replyBody = t.Object({
	text: t.String({ minLength: 1 }),
});

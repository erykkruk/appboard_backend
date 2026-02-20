import Elysia, { t } from "elysia";

export const pagination = new Elysia({ name: "pagination" }).macro({
	paginated() {
		return {
			query: t.Object({
				page: t.Optional(t.Numeric({ default: 1, minimum: 1 })),
				pageSize: t.Optional(
					t.Numeric({ default: 20, maximum: 100, minimum: 1 }),
				),
			}),
		};
	},
});

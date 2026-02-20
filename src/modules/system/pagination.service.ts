import { t } from "elysia";

export const paginationQuerySchema = t.Object({
	page: t.Optional(t.Numeric({ default: 1, minimum: 1 })),
	pageSize: t.Optional(t.Numeric({ default: 20, maximum: 100, minimum: 1 })),
});

export class PaginationService {
	static generateResponse<T>(
		data: T[],
		total: number,
		page: number,
		pageSize: number,
	) {
		return {
			data,
			pagination: {
				page,
				pageSize,
				total,
				totalPages: Math.ceil(total / pageSize),
			},
		};
	}
}

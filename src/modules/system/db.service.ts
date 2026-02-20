import { type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/utils/db";

export class DBService {
	static async queryPaginated<T extends PgTable>(
		table: T,
		page: number,
		pageSize: number,
		where?: SQL,
	) {
		const offset = (page - 1) * pageSize;

		const [data, countResult] = await Promise.all([
			db.select().from(table).where(where).limit(pageSize).offset(offset),
			db.select({ count: sql<number>`count(*)::int` }).from(table).where(where),
		]);

		return {
			data,
			total: countResult[0]?.count ?? 0,
		};
	}
}

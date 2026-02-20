import { and, eq } from "drizzle-orm";
import type { Platform } from "@/config/const";
import { db } from "@/utils/db";
import { apps, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

export class AppsService {
	static async findAll(filters?: { platform?: Platform; storeId?: string }) {
		const conditions = [];
		if (filters?.platform) {
			conditions.push(eq(apps.platform, filters.platform));
		}
		if (filters?.storeId) {
			conditions.push(eq(apps.storeId, filters.storeId));
		}

		const result = await db
			.select({
				app: apps,
				store: {
					id: stores.id,
					name: stores.name,
					type: stores.type,
				},
			})
			.from(apps)
			.leftJoin(stores, eq(apps.storeId, stores.id))
			.where(conditions.length > 0 ? and(...conditions) : undefined);

		return result.map((r) => ({
			...r.app,
			store: r.store,
		}));
	}

	static async findOne(appId: string) {
		const result = await db
			.select({
				app: apps,
				store: {
					id: stores.id,
					name: stores.name,
					type: stores.type,
				},
			})
			.from(apps)
			.leftJoin(stores, eq(apps.storeId, stores.id))
			.where(eq(apps.id, appId))
			.limit(1);

		if (result.length === 0) {
			buildError("notFound", { info: "App not found" });
		}

		return { ...result[0].app, store: result[0].store };
	}
}

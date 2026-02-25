import { and, eq } from "drizzle-orm";
import type { Platform } from "@/config/const";
import { db } from "@/utils/db";
import { apps, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

export class AppsService {
	static async findAll(
		workspaceId: string,
		filters?: { platform?: Platform; storeId?: string },
	) {
		const conditions = [eq(stores.workspaceId, workspaceId)];
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
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(and(...conditions));

		return result.map((r) => ({
			...r.app,
			store: r.store,
		}));
	}

	static async findOne(workspaceId: string, appId: string) {
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
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(and(eq(apps.id, appId), eq(stores.workspaceId, workspaceId)))
			.limit(1);

		if (result.length === 0) {
			buildError("notFound", { info: "App not found" });
		}

		return { ...result[0].app, store: result[0].store };
	}
}

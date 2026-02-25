import { and, eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { apps, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

export async function verifyStoreOwnership(
	storeId: string,
	workspaceId: string,
) {
	const [store] = await db
		.select({ id: stores.id })
		.from(stores)
		.where(and(eq(stores.id, storeId), eq(stores.workspaceId, workspaceId)))
		.limit(1);
	if (!store) buildError("notFound", { info: "Store not found" });
	return store;
}

export async function verifyAppOwnership(appId: string, workspaceId: string) {
	const [app] = await db
		.select({ id: apps.id })
		.from(apps)
		.innerJoin(stores, eq(apps.storeId, stores.id))
		.where(and(eq(apps.id, appId), eq(stores.workspaceId, workspaceId)))
		.limit(1);
	if (!app) buildError("notFound", { info: "App not found" });
	return app;
}

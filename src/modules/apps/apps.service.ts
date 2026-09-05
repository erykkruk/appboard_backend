import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Platform } from "@/config/const";
import { PUBLIC_CONNECTION_CAPABILITIES } from "@/config/store-capabilities";
import { db } from "@/utils/db";
import { apps, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("apps-service");

/** Marks an app that exists only inside AppBoard, with no store listing. */
export const NOT_IN_STORE = "notInStore";

export class AppsService {
	/**
	 * An app that is not published anywhere yet. There is no store listing to
	 * read, so nothing is fetched and nothing is audited - you write the
	 * listing here first, and connect a store later when you ship.
	 *
	 * It still hangs off a credential-less connection, which is what keeps
	 * every store write blocked with the same typed 403 as a link import: the
	 * app has no store to write to.
	 */
	static async createLocal(
		workspaceId: string,
		input: { name: string; platform: Platform; bundleId?: string },
	) {
		const name = input.name.trim();
		if (!name) {
			buildError("badRequest", { info: "Give the app a name." });
		}

		const type = input.platform === "ios" ? "app_store" : "google_play";
		let [store] = await db
			.select()
			.from(stores)
			.where(
				and(
					eq(stores.workspaceId, workspaceId),
					eq(stores.type, type),
					eq(stores.connectionMode, "public"),
				),
			)
			.limit(1);

		if (!store) {
			[store] = await db
				.insert(stores)
				.values({
					capabilities: PUBLIC_CONNECTION_CAPABILITIES,
					connectionMode: "public",
					name:
						type === "app_store"
							? "App Store (public)"
							: "Google Play (public)",
					status: "connected",
					type,
					workspaceId,
				})
				.returning();
		}

		// No store id exists yet, so we mint a local one. It deliberately cannot
		// collide with a real App Store id or a package name, so connecting a
		// real store later will never mis-bind this row to someone else's app.
		const localId = `local-${randomUUID()}`;
		const [app] = await db
			.insert(apps)
			.values({
				bundleId: input.bundleId?.trim() || localId,
				externalId: localId,
				name,
				platform: input.platform,
				rawData: { [NOT_IN_STORE]: true },
				status: "draft",
				storeId: store.id,
			})
			.returning();

		log.info({ appId: app.id, platform: input.platform }, "Local app created");
		return app;
	}

	/** True for an app that has no store listing behind it. */
	static isLocal(app: { rawData: unknown }): boolean {
		const raw = app.rawData as Record<string, unknown> | null;
		return raw?.[NOT_IN_STORE] === true;
	}

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
					connectionMode: stores.connectionMode,
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
					connectionMode: stores.connectionMode,
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

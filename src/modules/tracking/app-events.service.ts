import { desc, eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { appEvents } from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";

const log = createLogger("app-events");

/** Event kinds the rank chart knows how to mark. */
export type AppEventType =
	| "version_created"
	| "version_submitted"
	| "listing_published"
	| "screenshots_published"
	| "draft_reminder_sent";

/** Events that can plausibly move rankings, and so belong on the chart. */
export const CHART_EVENT_TYPES: ReadonlySet<string> = new Set([
	"version_created",
	"version_submitted",
	"listing_published",
	"screenshots_published",
]);

export class AppEventsService {
	/**
	 * Records something that could move rankings. Recording must never break
	 * the action that triggered it - a missing chart marker is a far smaller
	 * problem than a failed publish, so every failure is swallowed and logged.
	 */
	static async record(
		appId: string,
		type: AppEventType,
		label: string,
		meta?: Record<string, unknown>,
	): Promise<void> {
		try {
			await db.insert(appEvents).values({ appId, label, meta, type });
		} catch (err) {
			log.warn({ appId, err, type }, "Could not record app event");
		}
	}

	static async list(appId: string) {
		return db
			.select()
			.from(appEvents)
			.where(eq(appEvents.appId, appId))
			.orderBy(desc(appEvents.occurredAt));
	}
}

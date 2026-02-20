import { afterAll, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { settings, stores } from "@/utils/db/schema";

let app: import("@/index").App;

beforeAll(async () => {
	const mod = await import("@/index");
	app = mod.default as unknown as import("@/index").App;
});

afterAll(() => {
	app?.stop?.();
});

export function getBaseUrl() {
	return "http://localhost:3001";
}

/**
 * Cleanup helper: deletes only the stores created during a test suite.
 * Cascade deletes will remove all related apps, listings, assets, reviews, history.
 */
export async function cleanupStores(storeIds: string[]) {
	for (const id of storeIds) {
		await db.delete(stores).where(eq(stores.id, id));
	}
}

/**
 * Cleanup helper: deletes only the settings created during a test suite.
 */
export async function cleanupSettings(keys: string[]) {
	for (const key of keys) {
		await db.delete(settings).where(eq(settings.key, key));
	}
}

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import Elysia from "elysia";
import { storesController } from "@/modules/stores";
import { db } from "@/utils/db";
import { apps, stores } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
import { authGuard, authRequest, authRequestB, cleanupStores } from "./setup";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(storesController));

let storeId: string;

describe("Store full re-import (resync)", () => {
	beforeAll(async () => {
		const res = await app
			.handle(
				authRequest("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Resync Test Store",
						type: "google_play",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((r) => r.json());
		storeId = res.store.id;
	});

	afterAll(async () => {
		await cleanupStores([storeId]);
	});

	it("wipes stale local apps and imports fresh from the account", async () => {
		// Simulate an app left over from a previous account on this connection.
		await db.insert(apps).values({
			bundleId: "com.stale.leftover",
			externalId: "com.stale.leftover",
			name: "Stale App From Old Account",
			platform: "android",
			storeId,
		});

		const res = await app.handle(
			authRequest(`http://localhost/api/stores/${storeId}/resync`, {
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);

		const rows = await db
			.select({ externalId: apps.externalId })
			.from(apps)
			.where(eq(apps.storeId, storeId));
		const ids = rows.map((r) => r.externalId);
		expect(ids).not.toContain("com.stale.leftover");
		expect(ids.length).toBeGreaterThan(0);
	});

	it("keeps the store row connected after resync", async () => {
		const [row] = await db
			.select({ status: stores.status })
			.from(stores)
			.where(eq(stores.id, storeId));
		expect(row.status).toBe("connected");
	});

	it("denies resync of another workspace's store", async () => {
		const res = await app.handle(
			authRequestB(`http://localhost/api/stores/${storeId}/resync`, {
				method: "POST",
			}),
		);
		expect([403, 404]).toContain(res.status);
	});
});

describe("Store manual package add", () => {
	let pkgStoreId: string;

	beforeAll(async () => {
		const res = await app
			.handle(
				authRequest("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Package Add Test Store",
						type: "google_play",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((r) => r.json());
		pkgStoreId = res.store.id;
	});

	afterAll(async () => {
		await cleanupStores([pkgStoreId]);
	});

	it("adds a package to a Google Play connection and syncs", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/stores/${pkgStoreId}/packages`, {
				body: JSON.stringify({ packageName: "com.manual.draftapp" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
	});

	it("rejects an invalid package name", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/stores/${pkgStoreId}/packages`, {
				body: JSON.stringify({ packageName: "not a package!" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(422);
	});

	it("denies adding a package to another workspace's store", async () => {
		const res = await app.handle(
			authRequestB(`http://localhost/api/stores/${pkgStoreId}/packages`, {
				body: JSON.stringify({ packageName: "com.other.app" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect([403, 404]).toContain(res.status);
	});
});

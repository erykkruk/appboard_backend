import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { historyController } from "@/modules/history";
import { storesController } from "@/modules/stores";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
	getTestWorkspaceIdB,
} from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { db } from "@/utils/db";
import { listingHistory, listings } from "@/utils/db/schema";

const BASE = "http://localhost/api";
const FAKE_APP_ID = "00000000-0000-0000-0000-0000000000bb";
const FAKE_HISTORY_ID = "00000000-0000-0000-0000-0000000000cc";

type HistoryEntry = {
	id: string;
	appId: string;
	field: string;
	language: string;
	oldValue: string | null;
	newValue: string | null;
	createdAt: string;
	publishedAt: string | null;
	listingId: string | null;
};

type HistoryResponse = { history: HistoryEntry[] };

describe("History module", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) =>
			app.use(storesController).use(appsController).use(historyController),
		);

	let storeIdA: string;
	let appIdA: string;
	let storeIdB: string;
	let appIdB: string;

	async function resetAppState(targetAppId: string) {
		await db
			.delete(listingHistory)
			.where(eq(listingHistory.appId, targetAppId));
		await db.delete(listings).where(eq(listings.appId, targetAppId));
	}

	async function insertHistoryEntry(
		targetAppId: string,
		data: {
			field: string;
			language: string;
			oldValue: string | null;
			newValue: string | null;
			publishedAt?: Date;
			createdAt?: Date;
		},
	) {
		const [entry] = await db
			.insert(listingHistory)
			.values({
				appId: targetAppId,
				createdAt: data.createdAt ?? new Date(),
				field: data.field,
				language: data.language,
				newValue: data.newValue,
				oldValue: data.oldValue,
				publishedAt: data.publishedAt ?? new Date(),
			})
			.returning();
		return entry;
	}

	async function insertRemote(
		targetAppId: string,
		language: string,
		data: Partial<{
			title: string;
			shortDesc: string;
			fullDesc: string;
		}>,
	) {
		const [row] = await db
			.insert(listings)
			.values({
				appId: targetAppId,
				language,
				source: "remote",
				...data,
			})
			.returning();
		return row;
	}

	async function insertDraft(
		targetAppId: string,
		language: string,
		data: Partial<{
			title: string;
			shortDesc: string;
			fullDesc: string;
			isDirty: boolean;
		}>,
	) {
		const [row] = await db
			.insert(listings)
			.values({
				appId: targetAppId,
				isDirty: data.isDirty ?? false,
				language,
				source: "draft",
				...data,
			})
			.returning();
		return row;
	}

	async function getDraft(targetAppId: string, language: string) {
		const [draft] = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, targetAppId),
					eq(listings.language, language),
					eq(listings.source, "draft"),
				),
			)
			.limit(1);
		return draft;
	}

	beforeAll(async () => {
		const storeA = await seedTestStore(getTestWorkspaceId());
		storeIdA = storeA.id;
		const testAppA = await seedTestApp(storeA.id);
		appIdA = testAppA.id;

		const storeB = await seedTestStore(getTestWorkspaceIdB());
		storeIdB = storeB.id;
		const testAppB = await seedTestApp(storeB.id);
		appIdB = testAppB.id;
	});

	afterAll(async () => {
		const ids = [storeIdA, storeIdB].filter(Boolean);
		if (ids.length > 0) await cleanupStores(ids);
	});

	beforeEach(async () => {
		await resetAppState(appIdA);
	});

	// ── Test 1: GET empty ─────────────────────────────────────────

	it("GET /history returns empty array when no history exists", async () => {
		const res = await app.handle(authRequest(`${BASE}/apps/${appIdA}/history`));
		expect(res.status).toBe(200);
		const json = (await res.json()) as HistoryResponse;
		expect(json.history).toEqual([]);
	});

	// ── Test 2: GET returns entries sorted desc ───────────────────

	it("GET /history returns entries sorted by createdAt desc", async () => {
		const older = new Date(Date.now() - 60_000);
		const newer = new Date();

		await insertHistoryEntry(appIdA, {
			createdAt: older,
			field: "title",
			language: "en-US",
			newValue: "First new",
			oldValue: "First old",
		});
		await insertHistoryEntry(appIdA, {
			createdAt: newer,
			field: "shortDesc",
			language: "en-US",
			newValue: "Second new",
			oldValue: "Second old",
		});

		const res = await app.handle(authRequest(`${BASE}/apps/${appIdA}/history`));
		expect(res.status).toBe(200);
		const json = (await res.json()) as HistoryResponse;
		expect(json.history).toHaveLength(2);
		expect(json.history[0].field).toBe("shortDesc");
		expect(json.history[1].field).toBe("title");
	});

	// ── Test 3: Filter by language ────────────────────────────────

	it("GET /history?language=en-US returns only matching entries", async () => {
		await insertHistoryEntry(appIdA, {
			field: "title",
			language: "en-US",
			newValue: "EN new",
			oldValue: "EN old",
		});
		await insertHistoryEntry(appIdA, {
			field: "title",
			language: "pl-PL",
			newValue: "PL nowy",
			oldValue: "PL stary",
		});

		const res = await app.handle(
			authRequest(`${BASE}/apps/${appIdA}/history?language=en-US`),
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as HistoryResponse;
		expect(json.history).toHaveLength(1);
		expect(json.history[0].language).toBe("en-US");
	});

	// ── Test 4: Filter by field ───────────────────────────────────

	it("GET /history?field=title returns only title entries", async () => {
		await insertHistoryEntry(appIdA, {
			field: "title",
			language: "en-US",
			newValue: "new title",
			oldValue: "old title",
		});
		await insertHistoryEntry(appIdA, {
			field: "shortDesc",
			language: "en-US",
			newValue: "new short",
			oldValue: "old short",
		});
		await insertHistoryEntry(appIdA, {
			field: "title",
			language: "pl-PL",
			newValue: "nowy tytuł",
			oldValue: "stary tytuł",
		});

		const res = await app.handle(
			authRequest(`${BASE}/apps/${appIdA}/history?field=title`),
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as HistoryResponse;
		expect(json.history).toHaveLength(2);
		for (const entry of json.history) {
			expect(entry.field).toBe("title");
		}
	});

	// ── Test 5: Rollback updates existing draft ───────────────────

	it("POST /rollback updates existing draft field and marks isDirty", async () => {
		await insertRemote(appIdA, "en-US", { title: "Current remote" });
		await insertDraft(appIdA, "en-US", {
			isDirty: false,
			title: "Published latest",
		});

		const entry = await insertHistoryEntry(appIdA, {
			field: "title",
			language: "en-US",
			newValue: "Published latest",
			oldValue: "Previous value",
		});

		const res = await app.handle(
			authRequest(`${BASE}/apps/${appIdA}/history/${entry.id}/rollback`, {
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { success: boolean };
		expect(json.success).toBe(true);

		const draft = await getDraft(appIdA, "en-US");
		expect(draft).toBeDefined();
		expect(draft.title).toBe("Previous value");
		expect(draft.isDirty).toBe(true);
	});

	// ── Test 6: Rollback creates draft when none exists ───────────

	it("POST /rollback creates a new draft when none exists", async () => {
		await insertRemote(appIdA, "de-DE", {
			shortDesc: "Remote short",
			title: "Remote title",
		});

		const entry = await insertHistoryEntry(appIdA, {
			field: "title",
			language: "de-DE",
			newValue: "Remote title",
			oldValue: "Rolled-back title",
		});

		const res = await app.handle(
			authRequest(`${BASE}/apps/${appIdA}/history/${entry.id}/rollback`, {
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);

		const draft = await getDraft(appIdA, "de-DE");
		expect(draft).toBeDefined();
		expect(draft.title).toBe("Rolled-back title");
		expect(draft.isDirty).toBe(true);
		// Base data should have been copied from the remote listing
		expect(draft.shortDesc).toBe("Remote short");
	});

	// ── Test 7: Rollback unknown history id → 404 ────────────────

	it("POST /rollback returns 404 for unknown history id", async () => {
		const res = await app.handle(
			authRequest(
				`${BASE}/apps/${appIdA}/history/${FAKE_HISTORY_ID}/rollback`,
				{ method: "POST" },
			),
		);
		expect(res.status).toBe(404);
	});

	// ── Test 8: Workspace isolation ───────────────────────────────

	it("workspace B cannot GET history for workspace A app", async () => {
		await insertHistoryEntry(appIdA, {
			field: "title",
			language: "en-US",
			newValue: "A new",
			oldValue: "A old",
		});

		const res = await app.handle(
			authRequestB(`${BASE}/apps/${appIdA}/history`),
		);
		expect([403, 404]).toContain(res.status);
	});

	it("workspace B cannot POST rollback on workspace A history", async () => {
		const entry = await insertHistoryEntry(appIdA, {
			field: "title",
			language: "en-US",
			newValue: "A new",
			oldValue: "A old",
		});

		const res = await app.handle(
			authRequestB(`${BASE}/apps/${appIdA}/history/${entry.id}/rollback`, {
				method: "POST",
			}),
		);
		expect([403, 404]).toContain(res.status);

		// Fake app id also — must not leak through workspace B either
		const fakeRes = await app.handle(
			authRequestB(`${BASE}/apps/${FAKE_APP_ID}/history/${entry.id}/rollback`, {
				method: "POST",
			}),
		);
		expect([403, 404]).toContain(fakeRes.status);
	});

	it("workspace B can GET history for its own app independently", async () => {
		// Clean B's history for isolation
		await db.delete(listingHistory).where(eq(listingHistory.appId, appIdB));

		await db.insert(listingHistory).values({
			appId: appIdB,
			field: "title",
			language: "en-US",
			newValue: "B new",
			oldValue: "B old",
		});

		const res = await app.handle(
			authRequestB(`${BASE}/apps/${appIdB}/history`),
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as HistoryResponse;
		expect(json.history).toHaveLength(1);
		expect(json.history[0].oldValue).toBe("B old");

		// Cleanup B's history
		await db.delete(listingHistory).where(eq(listingHistory.appId, appIdB));
	});
});

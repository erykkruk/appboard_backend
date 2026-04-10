import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { listingsController } from "@/modules/listings";
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
import { listings } from "@/utils/db/schema";

const BASE = "http://localhost/api";
const FAKE_APP_ID = "00000000-0000-0000-0000-0000000000aa";

type DiffField = {
	field: string;
	oldValue: string | null;
	newValue: string | null;
};

type DiffResponse = {
	diffs: Array<{ language: string; fields: DiffField[] }>;
};

describe("Listings diffs", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) =>
			app.use(storesController).use(appsController).use(listingsController),
		);

	let storeIdA: string;
	let appIdA: string;
	let storeIdB: string;
	let appIdB: string;

	async function resetListings(targetAppId: string) {
		await db.delete(listings).where(eq(listings.appId, targetAppId));
	}

	async function insertRemote(
		targetAppId: string,
		language: string,
		data: Partial<{
			title: string;
			shortDesc: string;
			fullDesc: string;
			keywords: string;
		}>,
	) {
		await db.insert(listings).values({
			appId: targetAppId,
			language,
			source: "remote",
			...data,
		});
	}

	async function insertDraft(
		targetAppId: string,
		language: string,
		data: Partial<{
			title: string;
			shortDesc: string;
			fullDesc: string;
			keywords: string;
		}>,
	) {
		await db.insert(listings).values({
			appId: targetAppId,
			isDirty: true,
			language,
			source: "draft",
			...data,
		});
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

	// ── Test 1: No drafts → empty diffs ───────────────────────────

	it("returns empty diffs when app has only remote listings", async () => {
		await resetListings(appIdA);
		await insertRemote(appIdA, "en-US", {
			fullDesc: "Full description",
			title: "Remote Title",
		});
		await insertRemote(appIdA, "pl-PL", { title: "Zdalny tytuł" });

		const res = await app.handle(
			authRequest(`${BASE}/apps/${appIdA}/listings/diffs`),
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as DiffResponse;
		expect(json.diffs).toEqual([]);
	});

	// ── Test 2: Draft equal to remote → empty diffs ───────────────

	it("returns empty diffs when draft equals remote", async () => {
		await resetListings(appIdA);
		await insertRemote(appIdA, "en-US", {
			fullDesc: "Same full desc",
			shortDesc: "Same short",
			title: "Same Title",
		});
		await insertDraft(appIdA, "en-US", {
			fullDesc: "Same full desc",
			shortDesc: "Same short",
			title: "Same Title",
		});

		const res = await app.handle(
			authRequest(`${BASE}/apps/${appIdA}/listings/diffs`),
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as DiffResponse;
		expect(json.diffs).toEqual([]);
	});

	// ── Test 3: Draft with changed fields ─────────────────────────

	it("returns only changed fields when draft differs from remote", async () => {
		await resetListings(appIdA);
		await insertRemote(appIdA, "en-US", {
			fullDesc: "Old full desc",
			shortDesc: "Old short",
			title: "Old Title",
		});
		await insertDraft(appIdA, "en-US", {
			fullDesc: "Old full desc", // unchanged
			shortDesc: "New short", // changed
			title: "New Title", // changed
		});

		const res = await app.handle(
			authRequest(`${BASE}/apps/${appIdA}/listings/diffs`),
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as DiffResponse;

		expect(json.diffs).toHaveLength(1);
		expect(json.diffs[0].language).toBe("en-US");
		expect(json.diffs[0].fields).toHaveLength(2);

		const byField = new Map(json.diffs[0].fields.map((f) => [f.field, f]));
		expect(byField.get("title")).toEqual({
			field: "title",
			newValue: "New Title",
			oldValue: "Old Title",
		});
		expect(byField.get("shortDesc")).toEqual({
			field: "shortDesc",
			newValue: "New short",
			oldValue: "Old short",
		});
		expect(byField.has("fullDesc")).toBe(false);
	});

	// ── Test 4: Draft with no remote → all non-null draft fields ──

	it("returns all non-null draft fields with oldValue null when no remote exists", async () => {
		await resetListings(appIdA);
		await insertDraft(appIdA, "de-DE", {
			shortDesc: "Neue Kurzbeschreibung",
			title: "Neuer Titel",
		});

		const res = await app.handle(
			authRequest(`${BASE}/apps/${appIdA}/listings/diffs`),
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as DiffResponse;

		expect(json.diffs).toHaveLength(1);
		expect(json.diffs[0].language).toBe("de-DE");
		expect(json.diffs[0].fields).toHaveLength(2);

		for (const field of json.diffs[0].fields) {
			expect(field.oldValue).toBeNull();
		}

		const byField = new Map(json.diffs[0].fields.map((f) => [f.field, f]));
		expect(byField.get("title")?.newValue).toBe("Neuer Titel");
		expect(byField.get("shortDesc")?.newValue).toBe("Neue Kurzbeschreibung");
	});

	// ── Test 5: Multiple languages ────────────────────────────────

	it("returns only languages with diffs sorted alphabetically", async () => {
		await resetListings(appIdA);

		// pl-PL: no diff (draft equals remote)
		await insertRemote(appIdA, "pl-PL", { title: "Ten sam tytuł" });
		await insertDraft(appIdA, "pl-PL", { title: "Ten sam tytuł" });

		// en-US: has diff
		await insertRemote(appIdA, "en-US", { title: "English old" });
		await insertDraft(appIdA, "en-US", { title: "English new" });

		// de-DE: has diff
		await insertRemote(appIdA, "de-DE", { title: "Deutsch alt" });
		await insertDraft(appIdA, "de-DE", { title: "Deutsch neu" });

		const res = await app.handle(
			authRequest(`${BASE}/apps/${appIdA}/listings/diffs`),
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as DiffResponse;

		expect(json.diffs).toHaveLength(2);
		expect(json.diffs.map((d) => d.language)).toEqual(["de-DE", "en-US"]);
	});

	// ── Test 6: Workspace isolation ───────────────────────────────

	it("workspace B cannot fetch diffs for workspace A app", async () => {
		await resetListings(appIdA);
		await insertRemote(appIdA, "en-US", { title: "A title" });
		await insertDraft(appIdA, "en-US", { title: "A title new" });

		const res = await app.handle(
			authRequestB(`${BASE}/apps/${appIdA}/listings/diffs`),
		);
		expect([403, 404]).toContain(res.status);
	});

	it("workspace B can fetch diffs for its own app independently", async () => {
		await db
			.delete(listings)
			.where(and(eq(listings.appId, appIdB), eq(listings.source, "draft")));
		await db
			.delete(listings)
			.where(and(eq(listings.appId, appIdB), eq(listings.source, "remote")));
		await insertRemote(appIdB, "en-US", { title: "B old" });
		await insertDraft(appIdB, "en-US", { title: "B new" });

		const res = await app.handle(
			authRequestB(`${BASE}/apps/${appIdB}/listings/diffs`),
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as DiffResponse;
		expect(json.diffs).toHaveLength(1);
		expect(json.diffs[0].language).toBe("en-US");
	});

	// ── Test 7: Unknown app → 404 ─────────────────────────────────

	it("returns 404 for unknown app id", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/apps/${FAKE_APP_ID}/listings/diffs`),
		);
		expect(res.status).toBe(404);
	});
});

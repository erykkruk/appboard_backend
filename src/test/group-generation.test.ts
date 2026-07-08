import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { AIService } from "@/modules/ai/ai.service";
import { appGroupsController } from "@/modules/app-groups";
import { db } from "@/utils/db";
import { appGroupMembers, appGroups, apps, listings } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
} from "./setup";
import { seedTestApp, seedTestStore } from "./test-helpers";

const BASE = "http://localhost/api/app-groups";

const createdStoreIds: string[] = [];
const createdGroupIds: string[] = [];

describe("Group listing generation", () => {
	const app = new Elysia()
		.use(authGuard)
		.use(errorHandler)
		.group("/api", (a) => a.use(appGroupsController));

	let groupId: string;
	let androidAppId: string;
	let iosAppId: string;
	// biome-ignore lint/suspicious/noExplicitAny: test spy handle
	let generateSpy: any;

	beforeAll(async () => {
		const store = await seedTestStore(getTestWorkspaceId());
		createdStoreIds.push(store.id);

		const androidApp = await seedTestApp(store.id);
		androidAppId = androidApp.id;

		const [iosApp] = await db
			.insert(apps)
			.values({
				bundleId: "com.test.gen-ios",
				externalId: "gen-ios-1",
				name: "Gen Test iOS",
				platform: "ios",
				storeId: store.id,
			})
			.returning();
		iosAppId = iosApp.id;

		const [group] = await db
			.insert(appGroups)
			.values({
				name: `Gen Test Group ${crypto.randomUUID().slice(0, 8)}`,
				useSharedProfile: false,
				workspaceId: getTestWorkspaceId(),
			})
			.returning();
		groupId = group.id;
		createdGroupIds.push(groupId);

		await db.insert(appGroupMembers).values([
			{ appId: androidAppId, groupId, sortOrder: 0 },
			{ appId: iosAppId, groupId, sortOrder: 1 },
		]);

		// Mock the AI call — the generation pipeline, field mapping and draft
		// writes are the subject under test, not OpenRouter.
		generateSpy = spyOn(AIService, "generateListingField").mockImplementation(
			async (
				_workspaceId: string,
				field: string,
				_appId: string,
				_appName: string,
				platform: string,
			) => ({ model: "test-model", result: `AI ${field} for ${platform}` }),
		);
	});

	afterAll(async () => {
		generateSpy?.mockRestore();
		for (const id of createdGroupIds) {
			await db.delete(appGroups).where(eq(appGroups.id, id));
		}
		await cleanupStores(createdStoreIds);
	});

	it("generates drafts for every member with platform-specific fields", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/${groupId}/generate-listings`, {
				body: JSON.stringify({}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.sourceLanguage).toBe("en-US");
		expect(data.results).toHaveLength(2);

		const android = data.results.find(
			(r: { appId: string }) => r.appId === androidAppId,
		);
		const ios = data.results.find(
			(r: { appId: string }) => r.appId === iosAppId,
		);

		// Android: no keywords/promotionalText, subtitle mapped to shortDescription
		expect(Object.keys(android.generated).sort()).toEqual([
			"description",
			"shortDescription",
			"title",
			"whatsNew",
		]);
		// iOS: full field set
		expect(Object.keys(ios.generated).sort()).toEqual([
			"description",
			"keywords",
			"promotionalText",
			"subtitle",
			"title",
			"whatsNew",
		]);
		expect(android.errors).toHaveLength(0);
		expect(ios.errors).toHaveLength(0);
	});

	it("writes generated values into each app's draft listing", async () => {
		const [androidDraft] = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, androidAppId),
					eq(listings.language, "en-US"),
					eq(listings.source, "draft"),
				),
			)
			.limit(1);

		expect(androidDraft).toBeDefined();
		expect(androidDraft.isDirty).toBe(true);
		expect(androidDraft.title).toBe("AI title for android");
		expect(androidDraft.shortDesc).toBe("AI shortDescription for android");
		expect(androidDraft.fullDesc).toBe("AI description for android");
		expect(androidDraft.keywords).toBeNull(); // android has no keywords field

		const [iosDraft] = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, iosAppId),
					eq(listings.language, "en-US"),
					eq(listings.source, "draft"),
				),
			)
			.limit(1);

		expect(iosDraft).toBeDefined();
		expect(iosDraft.title).toBe("AI title for ios");
		expect(iosDraft.shortDesc).toBe("AI subtitle for ios");
		expect(iosDraft.keywords).toBe("AI keywords for ios");
		expect(iosDraft.promoText).toBe("AI promotionalText for ios");
	});

	it("respects an explicit fields subset", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/${groupId}/generate-listings`, {
				body: JSON.stringify({ fields: ["title"] }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		for (const result of data.results) {
			expect(Object.keys(result.generated)).toEqual(["title"]);
		}
	});

	it("reports per-field errors without aborting the run", async () => {
		generateSpy.mockImplementationOnce(async () => {
			throw new Error("model unavailable");
		});

		const res = await app.handle(
			authRequest(`${BASE}/${groupId}/generate-listings`, {
				body: JSON.stringify({ fields: ["title", "whatsNew"] }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		const withError = data.results[0];
		expect(withError.errors).toHaveLength(1);
		expect(withError.errors[0].message).toContain("model unavailable");
		// Second field still generated
		expect(Object.keys(withError.generated)).toEqual(["whatsNew"]);
		// Second app unaffected
		expect(data.results[1].errors).toHaveLength(0);
	});

	it("workspace B cannot generate for workspace A's group (404)", async () => {
		const res = await app.handle(
			authRequestB(`${BASE}/${groupId}/generate-listings`, {
				body: JSON.stringify({}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(404);
	});

	it("returns 404 for an unknown group", async () => {
		const res = await app.handle(
			authRequest(
				`${BASE}/00000000-0000-0000-0000-000000000000/generate-listings`,
				{
					body: JSON.stringify({}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(404);
	});
});

import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { AIService } from "@/modules/ai/ai.service";
import { appsController } from "@/modules/apps";
import { listingsController } from "@/modules/listings";
import { storesController } from "@/modules/stores";
import { db } from "@/utils/db";
import { listings } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceIdB,
} from "./setup";
import { seedTestApp, seedTestStore } from "./test-helpers";

const SOURCE_LANGUAGE = "en-US";
const TARGET_LANGUAGE = "de-DE";
const BRAND_TITLE = "AcmeBrand";
const SOURCE_DESC = "Original English description";
const INSTRUCTIONS = "Use a formal tone and keep sentences short.";

describe("Listings — Do Not Translate + translation instructions", () => {
	const app = new Elysia()
		.use(authGuard)
		.use(errorHandler)
		.group("/api", (group) =>
			group.use(storesController).use(appsController).use(listingsController),
		);

	let storeId: string;
	let appId: string;

	beforeAll(async () => {
		const store = await seedTestStore();
		storeId = store.id;
		const seededApp = await seedTestApp(storeId);
		appId = seededApp.id;

		// Source listing (remote) — provides the canonical brand title + desc.
		await db.insert(listings).values({
			appId,
			fullDesc: SOURCE_DESC,
			language: SOURCE_LANGUAGE,
			source: "remote",
			title: BRAND_TITLE,
		});

		// Target listing (remote) — exists so translate-from has a target language.
		await db.insert(listings).values({
			appId,
			language: TARGET_LANGUAGE,
			source: "remote",
			title: "Platzhalter",
		});
	});

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	it("PUT persists doNotTranslateFields + translationInstructions and GET returns them", async () => {
		const putRes = await app
			.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/${TARGET_LANGUAGE}`,
					{
						body: JSON.stringify({
							doNotTranslateFields: ["title"],
							translationInstructions: INSTRUCTIONS,
						}),
						headers: { "Content-Type": "application/json" },
						method: "PUT",
					},
				),
			)
			.then((res) => res.json());

		expect(putRes.listing).toBeDefined();
		expect(putRes.listing.source).toBe("draft");
		expect(putRes.listing.doNotTranslateFields).toEqual(["title"]);
		expect(putRes.listing.translationInstructions).toBe(INSTRUCTIONS);

		const getRes = await app
			.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/${TARGET_LANGUAGE}`,
				),
			)
			.then((res) => res.json());

		expect(getRes.draft).toBeDefined();
		expect(getRes.draft.doNotTranslateFields).toEqual(["title"]);
		expect(getRes.draft.translationInstructions).toBe(INSTRUCTIONS);
	});

	it("translate-from keeps DNT field verbatim, excludes it from the AI request, and forwards instructions", async () => {
		const spy = spyOn(AIService, "translateLocalization").mockResolvedValue({
			model: "mock-model",
			// AI translates only the description; title must NOT be requested.
			translations: { description: "Übersetzte Beschreibung" },
		});

		try {
			const res = await app
				.handle(
					authRequest(
						`http://localhost/api/apps/${appId}/listings/translate-from/${SOURCE_LANGUAGE}`,
						{ method: "POST" },
					),
				)
				.then((response) => response.json());

			expect(res.translated).toBeGreaterThanOrEqual(1);

			// The AI was called for the target language without the DNT field.
			expect(spy).toHaveBeenCalledTimes(1);
			const callArgs = spy.mock.calls[0];
			const aiFields = callArgs[4] as Record<string, string>;
			const instructionsArg = callArgs[7] as string | undefined;

			expect(aiFields).not.toHaveProperty("title");
			expect(aiFields).toHaveProperty("description");
			expect(instructionsArg).toBe(INSTRUCTIONS);

			// The persisted draft has the brand title copied verbatim from source,
			// while the description is the AI-translated value.
			const [draft] = await db
				.select()
				.from(listings)
				.where(
					and(
						eq(listings.appId, appId),
						eq(listings.language, TARGET_LANGUAGE),
						eq(listings.source, "draft"),
					),
				);

			expect(draft.title).toBe(BRAND_TITLE);
			expect(draft.fullDesc).toBe("Übersetzte Beschreibung");
		} finally {
			spy.mockRestore();
		}
	});

	it("workspace B cannot PUT workspace A's listing (404 via verifyAppOwnership)", async () => {
		const res = await app.handle(
			authRequestB(
				`http://localhost/api/apps/${appId}/listings/${TARGET_LANGUAGE}`,
				{
					body: JSON.stringify({ doNotTranslateFields: ["title"] }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				},
			),
		);

		expect(res.status).toBe(404);
	});

	it("workspace B cannot translate workspace A's listing (404 via verifyAppOwnership)", async () => {
		const res = await app.handle(
			authRequestB(
				`http://localhost/api/apps/${appId}/listings/translate-from/${SOURCE_LANGUAGE}`,
				{ method: "POST" },
			),
		);

		expect(res.status).toBe(404);
	});

	it("workspace B's identifiers are isolated", () => {
		// Sanity: ensure the two workspaces are distinct so the 404s above are
		// genuine ownership failures, not coincidental missing data.
		expect(getTestWorkspaceIdB()).not.toBe(storeId);
	});
});

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { bulkController } from "@/modules/bulk";
import type {
	BulkCopyApplyResponse,
	BulkCopyPreview,
} from "@/modules/bulk/bulk.types";
import { db } from "@/utils/db";
import {
	appAiPrompts,
	appAsoProfiles,
	apps,
	listings,
	stores,
	trackedKeywords,
} from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
	getTestWorkspaceIdB,
} from "./setup";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(bulkController));

const SOURCE_TITLE = "Pomo: Focus Timer (draft)";
const SOURCE_KEYWORDS_FIELD = "focus,timer,pomodoro";

async function seedPublicStore(
	workspaceId: string,
	type: "app_store" | "google_play",
) {
	const [store] = await db
		.insert(stores)
		.values({
			connectionMode: "public",
			name: `${type} (public)`,
			status: "connected",
			type,
			workspaceId,
		})
		.returning();
	return store.id;
}

async function seedApp(
	storeId: string,
	name: string,
	platform: "ios" | "android",
) {
	const [row] = await db
		.insert(apps)
		.values({
			bundleId: `com.example.${name.toLowerCase().replace(/\W+/g, "")}`,
			externalId: `${Math.floor(Math.random() * 1_000_000_000)}`,
			name,
			platform,
			rawData: { publicCountry: "us" },
			storeId,
		})
		.returning();
	return row.id;
}

function post(path: string, body: unknown, asB = false) {
	const build = asB ? authRequestB : authRequest;
	return app.handle(
		build(`http://localhost/api${path}`, {
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		}),
	);
}

async function targetState(appId: string) {
	const [profile] = await db
		.select()
		.from(appAsoProfiles)
		.where(eq(appAsoProfiles.appId, appId));
	const keywords = await db
		.select()
		.from(trackedKeywords)
		.where(eq(trackedKeywords.appId, appId));
	const [draft] = await db
		.select()
		.from(listings)
		.where(and(eq(listings.appId, appId), eq(listings.source, "draft")));
	const prompts = await db
		.select()
		.from(appAiPrompts)
		.where(eq(appAiPrompts.appId, appId));
	return { draft: draft ?? null, keywords, profile: profile ?? null, prompts };
}

describe("bulk copy", () => {
	const storeIds: string[] = [];
	let sourceAppId: string;
	let targetAppId: string;
	let androidAppId: string;
	let foreignAppId: string;

	beforeAll(async () => {
		const iosStoreId = await seedPublicStore(getTestWorkspaceId(), "app_store");
		const playStoreId = await seedPublicStore(
			getTestWorkspaceId(),
			"google_play",
		);
		const foreignStoreId = await seedPublicStore(
			getTestWorkspaceIdB(),
			"app_store",
		);
		storeIds.push(iosStoreId, playStoreId, foreignStoreId);

		sourceAppId = await seedApp(iosStoreId, "Pomo Source", "ios");
		targetAppId = await seedApp(iosStoreId, "Pomo Target", "ios");
		androidAppId = await seedApp(playStoreId, "Pomo Android", "android");
		foreignAppId = await seedApp(foreignStoreId, "Foreign App", "ios");

		await db.insert(appAsoProfiles).values({
			appId: sourceAppId,
			category: "Productivity",
			keyFeatures: ["Timer", "Statistics"],
			mainBenefit: "Stay focused",
			oneLiner: "A focus timer",
		});
		await db.insert(trackedKeywords).values([
			{ appId: sourceAppId, country: "us", keyword: "focus timer" },
			{ appId: sourceAppId, country: "us", keyword: "pomodoro" },
			{ appId: sourceAppId, country: "pl", keyword: "minutnik" },
		]);
		await db.insert(appAiPrompts).values({
			appId: sourceAppId,
			field: "title",
			mode: "generate",
			prompt: "Keep it short",
		});
		// The source has both rows for en-US: the draft must win over remote.
		await db.insert(listings).values([
			{
				appId: sourceAppId,
				fullDesc: "Remote description",
				language: "en-US",
				source: "remote",
				title: "Pomo: Focus Timer",
			},
			{
				appId: sourceAppId,
				fullDesc: "Remote description",
				isDirty: true,
				keywords: SOURCE_KEYWORDS_FIELD,
				language: "en-US",
				source: "draft",
				title: SOURCE_TITLE,
			},
			{
				appId: sourceAppId,
				language: "de-DE",
				source: "remote",
				title: "Pomo: Fokus Timer",
			},
			// Target only has a remote row, so the copy must create its draft.
			{
				appId: targetAppId,
				fullDesc: "Remote description",
				language: "en-US",
				source: "remote",
				title: "Old target title",
			},
		]);
		// Same keyword already tracked on the target: it must not count as changed.
		await db.insert(trackedKeywords).values({
			appId: targetAppId,
			country: "us",
			keyword: "pomodoro",
		});
	});

	afterAll(async () => {
		await cleanupStores(storeIds);
	});

	it("preview lists the changes without writing anything", async () => {
		const res = await post("/apps/bulk-copy/preview", {
			parts: ["about", "keywords", "listings", "prompts"],
			sourceAppId,
			targetAppIds: [targetAppId],
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as BulkCopyPreview;

		const aboutFields = body.changes
			.filter((c) => c.part === "about")
			.map((c) => c.field);
		expect(aboutFields).toContain("category");
		expect(aboutFields).toContain("keyFeatures");

		const keywordChanges = body.changes.filter((c) => c.part === "keywords");
		expect(keywordChanges.map((c) => c.after).sort()).toEqual([
			"focus timer",
			"minutnik",
		]);

		const title = body.changes.find(
			(c) => c.part === "listings" && c.field === "title",
		);
		expect(title?.language).toBe("en-US");
		expect(title?.before).toBe("Old target title");
		expect(title?.after).toBe(SOURCE_TITLE);
		// fullDesc is identical on both sides, so it is not a change.
		expect(
			body.changes.find((c) => c.part === "listings" && c.field === "fullDesc"),
		).toBeUndefined();
		expect(body.changes.find((c) => c.part === "prompts")?.field).toBe(
			"title:generate",
		);
		expect(body.skipped).toEqual([]);

		const state = await targetState(targetAppId);
		expect(state.profile).toBeNull();
		expect(state.draft).toBeNull();
		expect(state.prompts).toEqual([]);
		expect(state.keywords.map((k) => k.keyword)).toEqual(["pomodoro"]);
	});

	it("rejects the whole request when a target belongs to another workspace", async () => {
		const res = await post("/apps/bulk-copy", {
			parts: ["about", "keywords"],
			sourceAppId,
			targetAppIds: [targetAppId, foreignAppId],
		});
		expect(res.status).toBe(404);

		const foreign = await targetState(foreignAppId);
		expect(foreign.profile).toBeNull();
		expect(foreign.keywords).toEqual([]);
		const target = await targetState(targetAppId);
		expect(target.profile).toBeNull();
	});

	it("rejects a foreign source app", async () => {
		const res = await post("/apps/bulk-copy/preview", {
			parts: ["about"],
			sourceAppId: foreignAppId,
			targetAppIds: [targetAppId],
		});
		expect(res.status).toBe(404);
	});

	it("workspace B cannot use workspace A apps at all", async () => {
		const res = await post(
			"/apps/bulk-copy",
			{ parts: ["about"], sourceAppId, targetAppIds: [targetAppId] },
			true,
		);
		expect(res.status).toBe(404);
		expect((await targetState(targetAppId)).profile).toBeNull();
	});

	it("skips a target equal to the source", async () => {
		const res = await post("/apps/bulk-copy/preview", {
			parts: ["about", "keywords"],
			sourceAppId,
			targetAppIds: [sourceAppId],
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as BulkCopyPreview;
		expect(body.changes).toEqual([]);
		expect(body.skipped.map((s) => s.part).sort()).toEqual([
			"about",
			"keywords",
		]);
		expect(body.skipped[0].reason).toBe("Target is the source app");
	});

	it("skips listings across platforms but still copies the rest", async () => {
		const res = await post("/apps/bulk-copy", {
			parts: ["listings", "about"],
			sourceAppId,
			targetAppIds: [androidAppId],
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as BulkCopyApplyResponse;

		const listing = body.results.find((r) => r.part === "listings");
		expect(listing?.status).toBe("skipped");
		expect(listing?.message).toContain("same platform");
		expect(listing?.changed).toBe(0);

		const about = body.results.find((r) => r.part === "about");
		expect(about?.status).toBe("ok");
		expect(about?.changed).toBeGreaterThan(0);

		const state = await targetState(androidAppId);
		expect(state.profile?.category).toBe("Productivity");
		expect(state.draft).toBeNull();
	});

	it("applies about + keywords + listings onto the target", async () => {
		const res = await post("/apps/bulk-copy", {
			parts: ["about", "keywords", "listings"],
			sourceAppId,
			targetAppIds: [targetAppId],
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as BulkCopyApplyResponse;
		expect(body.results).toHaveLength(3);
		for (const result of body.results) {
			expect(result.appId).toBe(targetAppId);
			expect(result.appName).toBe("Pomo Target");
			expect(result.status).toBe("ok");
		}
		expect(body.results.find((r) => r.part === "keywords")?.changed).toBe(2);

		const state = await targetState(targetAppId);
		expect(state.profile?.category).toBe("Productivity");
		expect(state.profile?.keyFeatures).toEqual(["Timer", "Statistics"]);
		expect(state.profile?.mainBenefit).toBe("Stay focused");

		const tracked = state.keywords
			.map((k) => `${k.country}:${k.keyword}`)
			.sort();
		expect(tracked).toEqual(["pl:minutnik", "us:focus timer", "us:pomodoro"]);

		const drafts = await db
			.select()
			.from(listings)
			.where(
				and(eq(listings.appId, targetAppId), eq(listings.source, "draft")),
			);
		const enDraft = drafts.find((d) => d.language === "en-US");
		expect(enDraft?.isDirty).toBe(true);
		expect(enDraft?.title).toBe(SOURCE_TITLE);
		expect(enDraft?.keywords).toBe(SOURCE_KEYWORDS_FIELD);
		// Untouched remote fields survive the draft creation.
		expect(enDraft?.fullDesc).toBe("Remote description");
		const deDraft = drafts.find((d) => d.language === "de-DE");
		expect(deDraft?.title).toBe("Pomo: Fokus Timer");

		// The source itself is never modified by a copy.
		const [sourceRemote] = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, sourceAppId),
					eq(listings.language, "en-US"),
					eq(listings.source, "remote"),
				),
			);
		expect(sourceRemote.title).toBe("Pomo: Focus Timer");
	});

	it("reports an identical target as skipped on a second run", async () => {
		const res = await post("/apps/bulk-copy", {
			parts: ["about", "keywords", "listings"],
			sourceAppId,
			targetAppIds: [targetAppId],
		});
		const body = (await res.json()) as BulkCopyApplyResponse;
		for (const result of body.results) {
			expect(result.status).toBe("skipped");
			expect(result.message).toBe("Already identical");
			expect(result.changed).toBe(0);
		}
	});

	it("validates the body", async () => {
		const unknownPart = await post("/apps/bulk-copy/preview", {
			parts: ["screenshots"],
			sourceAppId,
			targetAppIds: [targetAppId],
		});
		expect(unknownPart.status).toBe(422);

		const noTargets = await post("/apps/bulk-copy/preview", {
			parts: ["about"],
			sourceAppId,
			targetAppIds: [],
		});
		expect(noTargets.status).toBe(422);
	});
});

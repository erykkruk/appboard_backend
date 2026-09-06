import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { auditController } from "@/modules/audit";
import { db } from "@/utils/db";
import { appAudits, apps, stores } from "@/utils/db/schema";
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
	.group("/api", (a) => a.use(auditController));

const realFetch = globalThis.fetch;
const APPLE_ID = "555000111";

// A listing that is deliberately thin: 2 screenshots and a 60-character
// description, so the rules have something real to fire on.
const LOOKUP = {
	resultCount: 1,
	results: [
		{
			artworkUrl100: "https://example.com/icon.png",
			averageUserRating: 4.7,
			bundleId: "com.example.pomodoro",
			currentVersionReleaseDate: new Date().toISOString(),
			description: "Focus timer for deep work. Focus timer keeps you honest.",
			formattedPrice: "Free",
			genres: ["Productivity"],
			languageCodesISO2A: ["EN"],
			price: 0,
			primaryGenreName: "Productivity",
			screenshotUrls: [
				"https://example.com/1.png",
				"https://example.com/2.png",
			],
			sellerName: "Example Inc",
			trackId: Number(APPLE_ID),
			trackName: "Pomo: Focus Timer",
			trackViewUrl: `https://apps.apple.com/us/app/pomo/id${APPLE_ID}`,
			userRatingCount: 900,
			version: "1.0",
		},
	],
};

function searchPayload() {
	return {
		resultCount: 3,
		results: [
			{
				averageUserRating: 4.8,
				formattedPrice: "Free",
				genres: ["Productivity"],
				primaryGenreName: "Productivity",
				releaseDate: "2019-01-01T00:00:00Z",
				sellerName: "Rival A",
				trackId: 111,
				trackName: "Forest: Focus Timer",
				trackViewUrl: "https://apps.apple.com/us/app/x/id111",
				userRatingCount: 90_000,
			},
			{
				averageUserRating: 4.6,
				formattedPrice: "Free",
				genres: ["Productivity"],
				primaryGenreName: "Productivity",
				releaseDate: "2020-01-01T00:00:00Z",
				sellerName: "Rival B",
				trackId: 222,
				trackName: "Flow: Focus Timer",
				trackViewUrl: "https://apps.apple.com/us/app/y/id222",
				userRatingCount: 12_000,
			},
			{
				averageUserRating: 4.2,
				formattedPrice: "Free",
				genres: ["Productivity"],
				primaryGenreName: "Productivity",
				releaseDate: "2021-01-01T00:00:00Z",
				sellerName: "Example Inc",
				trackId: Number(APPLE_ID),
				trackName: "Pomo: Focus Timer",
				trackViewUrl: `https://apps.apple.com/us/app/pomo/id${APPLE_ID}`,
				userRatingCount: 900,
			},
		],
	};
}

function stubItunes() {
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url.includes("/lookup")) {
			return new Response(JSON.stringify(LOOKUP), {
				headers: { "content-type": "application/json" },
			});
		}
		if (url.includes("/search")) {
			return new Response(JSON.stringify(searchPayload()), {
				headers: { "content-type": "application/json" },
			});
		}
		return new Response("{}", {
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
}

async function seedApp(workspaceId: string) {
	const [store] = await db
		.insert(stores)
		.values({
			connectionMode: "public",
			name: "App Store (public)",
			status: "connected",
			type: "app_store",
			workspaceId,
		})
		.returning();
	const [appRow] = await db
		.insert(apps)
		.values({
			bundleId: "com.example.pomodoro",
			externalId: APPLE_ID,
			name: "Pomo: Focus Timer",
			platform: "ios",
			primaryCategory: "Productivity",
			rawData: { publicCountry: "us" },
			storeId: store.id,
		})
		.returning();
	return { appId: appRow.id, storeId: store.id };
}

/** The refresh runs detached, so wait for the row instead of guessing a delay. */
async function waitForReady(appId: string, timeoutMs = 20_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const [row] = await db
			.select()
			.from(appAudits)
			.where(eq(appAudits.appId, appId))
			.limit(1);
		if (row?.status === "ready") return row;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("audit did not become ready in time");
}

describe("app audit", () => {
	const storeIds: string[] = [];

	afterEach(() => {
		globalThis.fetch = realFetch;
	});
	afterAll(async () => {
		await cleanupStores(storeIds);
	});

	it("answers immediately with measuring, then stores a real report", async () => {
		stubItunes();
		const seeded = await seedApp(getTestWorkspaceId());
		storeIds.push(seeded.storeId);

		const first = await app.handle(
			authRequest(`http://localhost/api/apps/${seeded.appId}/audit`),
		);
		expect(first.status).toBe(200);
		const firstBody = (await first.json()) as {
			status: string;
			report: unknown;
		};
		// A first read must never block and must never invent a score.
		expect(firstBody.status).toBe("measuring");
		expect(firstBody.report).toBeNull();

		await waitForReady(seeded.appId);

		const second = await app.handle(
			authRequest(`http://localhost/api/apps/${seeded.appId}/audit`),
		);
		const body = (await second.json()) as {
			status: string;
			report: {
				country: string;
				keywords: unknown[];
				store: { asoScore: number; issues: { id: string }[] };
			};
		};
		expect(body.status).toBe("ready");
		expect(body.report.country).toBe("us");
		expect(body.report.store.asoScore).toBeGreaterThan(0);
		expect(body.report.store.asoScore).toBeLessThanOrEqual(100);
		expect(body.report.keywords.length).toBeGreaterThan(0);
		// Two screenshots and a 56-character description are real defects.
		const ids = body.report.store.issues.map((i) => i.id);
		expect(ids).toContain("screenshots");
		expect(ids).toContain("description-short");
	});

	it("keeps the report inside its workspace", async () => {
		stubItunes();
		const seeded = await seedApp(getTestWorkspaceId());
		storeIds.push(seeded.storeId);

		const res = await app.handle(
			authRequestB(`http://localhost/api/apps/${seeded.appId}/audit`),
		);
		expect(res.status).toBe(404);
		expect(getTestWorkspaceIdB()).not.toBe(getTestWorkspaceId());
	});

	it("refuses a Google Play app instead of inventing difficulty", async () => {
		stubItunes();
		const [store] = await db
			.insert(stores)
			.values({
				connectionMode: "public",
				name: "Google Play (public)",
				status: "connected",
				type: "google_play",
				workspaceId: getTestWorkspaceId(),
			})
			.returning();
		storeIds.push(store.id);
		const [appRow] = await db
			.insert(apps)
			.values({
				bundleId: "com.example.play",
				externalId: "com.example.play",
				name: "Play App",
				platform: "android",
				rawData: { publicCountry: "us" },
				storeId: store.id,
			})
			.returning();

		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appRow.id}/audit`),
		);
		// Reads are cache-first, so the refusal surfaces once the run executes.
		const body = (await res.json()) as { status: string };
		expect(body.status).toBe("measuring");
		await new Promise((r) => setTimeout(r, 800));
		const [row] = await db
			.select()
			.from(appAudits)
			.where(eq(appAudits.appId, appRow.id))
			.limit(1);
		expect(row?.status).toBe("failed");
	});
});

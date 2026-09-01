import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { listingsController } from "@/modules/listings";
import { publishingController } from "@/modules/publishing";
import { reviewsController } from "@/modules/reviews";
import { storesController } from "@/modules/stores";
import { storeCapabilityGuard } from "@/modules/stores/store-capabilities.guard";
import { parseStoreLink } from "@/modules/stores/store-url";
import { vaultActionGuard } from "@/modules/vault/vault.guard";
import { vaultSession } from "@/modules/vault/vault.session";
import { db } from "@/utils/db";
import { apps, listings, stores } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
	TEST_VAULT_DEK,
} from "./setup";

// Guard order mirrors src/index.ts: vault gate before the capability gate.
const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) =>
		a
			.use(vaultActionGuard)
			.use(storeCapabilityGuard)
			.use(storesController)
			.use(listingsController)
			.use(reviewsController)
			.use(publishingController),
	);

const realFetch = globalThis.fetch;

// The canned mock App Store provider serves externalId 1234567890 — importing
// the same id first lets the upgrade test watch the app re-bind on connect.
const APPLE_ID = "1234567890";

const ITUNES_LOOKUP = {
	resultCount: 1,
	results: [
		{
			artworkUrl100: "https://example.com/icon.png",
			averageUserRating: 4.5,
			bundleId: "com.example.taskmaster",
			description: "A great task app",
			formattedPrice: "Free",
			genres: ["Productivity", "Utilities"],
			price: 0,
			releaseNotes: "Bug fixes",
			screenshotUrls: [
				"https://example.com/s1.png",
				"https://example.com/s2.png",
			],
			sellerName: "Example Inc",
			trackId: Number(APPLE_ID),
			trackName: "TaskMaster",
			trackViewUrl: `https://apps.apple.com/us/app/taskmaster/id${APPLE_ID}`,
			userRatingCount: 100,
			version: "2.0",
		},
	],
};

const RSS_REVIEWS = {
	feed: {
		entry: [
			{
				content: { label: "Love this app, use it daily" },
				"im:rating": { label: "5" },
				"im:version": { label: "2.0" },
				title: { label: "Great" },
			},
			{
				content: { label: "Crashes on start sometimes" },
				"im:rating": { label: "2" },
				"im:version": { label: "2.0" },
				title: { label: "Buggy" },
			},
		],
	},
};

/** Stub outbound iTunes calls; everything else is an error (no real network). */
function stubItunes(): void {
	globalThis.fetch = (async (input: unknown) => {
		const url = String(input);
		if (url.includes("itunes.apple.com/lookup")) {
			return Response.json(ITUNES_LOOKUP);
		}
		if (url.includes("rss/customerreviews")) {
			return Response.json(RSS_REVIEWS);
		}
		throw new Error(`Unstubbed request: ${url}`);
	}) as typeof globalThis.fetch;
}

afterEach(() => {
	globalThis.fetch = realFetch;
});

const createdStoreIds: string[] = [];

afterAll(async () => {
	await cleanupStores(createdStoreIds);
	// The import flow creates public stores itself — sweep any it left behind
	// without touching other suites' connections.
	await db
		.delete(stores)
		.where(
			and(
				eq(stores.workspaceId, getTestWorkspaceId()),
				eq(stores.connectionMode, "public"),
			),
		);
});

describe("parseStoreLink", () => {
	it("parses App Store URLs with country", () => {
		expect(
			parseStoreLink("https://apps.apple.com/pl/app/spotify/id324684580"),
		).toEqual({ country: "pl", externalId: "324684580", type: "app_store" });
	});

	it("parses Google Play URLs with gl param", () => {
		expect(
			parseStoreLink(
				"https://play.google.com/store/apps/details?id=com.spotify.music&gl=PL",
			),
		).toEqual({
			country: "pl",
			externalId: "com.spotify.music",
			type: "google_play",
		});
	});

	it("accepts a bare numeric Apple id", () => {
		expect(parseStoreLink("324684580")).toEqual({
			externalId: "324684580",
			type: "app_store",
		});
	});

	it("accepts a bare Android package name", () => {
		expect(parseStoreLink("com.example.app")).toEqual({
			externalId: "com.example.app",
			type: "google_play",
		});
	});

	it("rejects garbage", () => {
		expect(parseStoreLink("")).toBeNull();
		expect(parseStoreLink("https://example.com/app/id123456789")).toBeNull();
		expect(parseStoreLink("not a link")).toBeNull();
	});
});

describe("POST /api/stores/import", () => {
	let importedAppId: string;
	let publicStoreId: string;

	it("imports an App Store app from a link without credentials", async () => {
		stubItunes();
		const res = await app.handle(
			authRequest("http://localhost/api/stores/import", {
				body: JSON.stringify({
					url: `https://apps.apple.com/us/app/taskmaster/id${APPLE_ID}`,
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.created).toBe(true);
		expect(data.app.externalId).toBe(APPLE_ID);
		expect(data.app.name).toBe("TaskMaster");
		expect(data.app.bundleId).toBe("com.example.taskmaster");
		expect(data.app.platform).toBe("ios");
		expect(data.app.store.connectionMode).toBe("public");
		expect(data.app.rawData.publicCountry).toBe("us");

		importedAppId = data.app.id;
		publicStoreId = data.app.store.id;
		createdStoreIds.push(publicStoreId);

		// The import pulls the public listing right away.
		const rows = await db
			.select()
			.from(listings)
			.where(eq(listings.appId, importedAppId));
		const remote = rows.find((r) => r.source === "remote");
		expect(remote?.title).toBe("TaskMaster");
		expect(remote?.fullDesc).toBe("A great task app");
		expect(remote?.whatsNew).toBe("Bug fixes");
	});

	it("returns the existing app instead of duplicating on re-import", async () => {
		stubItunes();
		const res = await app.handle(
			authRequest("http://localhost/api/stores/import", {
				body: JSON.stringify({
					url: `https://apps.apple.com/us/app/x/id${APPLE_ID}`,
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.created).toBe(false);
		expect(data.app.id).toBe(importedAppId);
	});

	it("accepts a typeahead pick (platform + externalId)", async () => {
		stubItunes();
		const res = await app.handle(
			authRequest("http://localhost/api/stores/import", {
				body: JSON.stringify({
					country: "us",
					externalId: APPLE_ID,
					platform: "ios",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.app.id).toBe(importedAppId);
	});

	it("rejects an unrecognized link with 400", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/stores/import", {
				body: JSON.stringify({ url: "https://example.com/nope" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(400);
	});

	it("returns 404 when the app does not exist on the store", async () => {
		globalThis.fetch = (async (_input: unknown) =>
			Response.json({
				resultCount: 0,
				results: [],
			})) as typeof globalThis.fetch;
		const res = await app.handle(
			authRequest("http://localhost/api/stores/import", {
				body: JSON.stringify({
					url: "https://apps.apple.com/us/app/ghost/id999999999",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(404);
	});

	it("keeps the imported app invisible to another workspace", async () => {
		const res = await app.handle(authRequestB("http://localhost/api/stores/"));
		expect(res.status).toBe(200);
		const data = await res.json();
		const ids = data.stores.map((s: { id: string }) => s.id);
		expect(ids).not.toContain(publicStoreId);
	});

	it("lists the public connection with connectionMode=public", async () => {
		const res = await app.handle(authRequest("http://localhost/api/stores/"));
		const data = await res.json();
		const row = data.stores.find((s: { id: string }) => s.id === publicStoreId);
		expect(row.connectionMode).toBe("public");
		expect(row.status).toBe("connected");
	});

	it("syncs public reviews from the RSS feed", async () => {
		stubItunes();
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${importedAppId}/reviews/sync`, {
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);

		const list = await app.handle(
			authRequest(`http://localhost/api/apps/${importedAppId}/reviews`),
		);
		const reviewsData = await list.json();
		const bodies = JSON.stringify(reviewsData);
		expect(bodies).toContain("Love this app");
	});

	it("blocks review replies with 403 INTEGRATION_REQUIRED", async () => {
		const list = await app.handle(
			authRequest(`http://localhost/api/apps/${importedAppId}/reviews`),
		);
		const reviewsData = await list.json();
		const first = reviewsData.reviews[0];
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${importedAppId}/reviews/${first.id}/reply`,
				{
					body: JSON.stringify({ text: "Thanks for the feedback!" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);
		expect(res.status).toBe(403);
		const err = await res.json();
		expect(err.code).toBe("INTEGRATION_REQUIRED");
	});

	it("keeps draft editing local and blocks publish with 403", async () => {
		// Draft edits are local — they must work for a public app.
		const draft = await app.handle(
			authRequest(`http://localhost/api/apps/${importedAppId}/listings/en`, {
				body: JSON.stringify({ title: "TaskMaster Pro" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);
		expect(draft.status).toBe(200);

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${importedAppId}/listings/publish`,
				{ method: "POST" },
			),
		);
		expect(res.status).toBe(403);
		const err = await res.json();
		expect(err.code).toBe("INTEGRATION_REQUIRED");
	});

	it("blocks publishing routes at the guard with 403", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${importedAppId}/publishing/publish`,
				{
					body: JSON.stringify({}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);
		expect(res.status).toBe(403);
		const err = await res.json();
		expect(err.code).toBe("INTEGRATION_REQUIRED");
	});

	it("stays fully usable for public apps while the vault is locked", async () => {
		vaultSession.lock(getTestWorkspaceId());
		try {
			stubItunes();
			// Import is credential-less by design — no vault needed.
			const imp = await app.handle(
				authRequest("http://localhost/api/stores/import", {
					body: JSON.stringify({
						url: `https://apps.apple.com/us/app/x/id${APPLE_ID}`,
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			);
			expect(imp.status).toBe(200);

			// Local draft edits and public-data syncs stay open too.
			const draft = await app.handle(
				authRequest(`http://localhost/api/apps/${importedAppId}/listings/en`, {
					body: JSON.stringify({ title: "Locked-vault edit" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			);
			expect(draft.status).toBe(200);

			const sync = await app.handle(
				authRequest(`http://localhost/api/apps/${importedAppId}/reviews/sync`, {
					method: "POST",
				}),
			);
			expect(sync.status).toBe(200);
		} finally {
			vaultSession.unlock(getTestWorkspaceId(), TEST_VAULT_DEK);
		}
	});

	it("re-binds the app to a real connection and drops the empty public store", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/stores/connect", {
				body: JSON.stringify({
					credentials: { mock: true },
					name: "Real App Store",
					type: "app_store",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		const data = await res.json();
		createdStoreIds.push(data.store.id);

		// Same app row, new store — drafts and history survive the upgrade.
		const [row] = await db
			.select()
			.from(apps)
			.where(eq(apps.id, importedAppId))
			.limit(1);
		expect(row.storeId).toBe(data.store.id);

		const draftRows = await db
			.select()
			.from(listings)
			.where(eq(listings.appId, importedAppId));
		expect(draftRows.some((r) => r.source === "draft")).toBe(true);

		// The public connection had only this app — it is gone now.
		const [publicRow] = await db
			.select()
			.from(stores)
			.where(eq(stores.id, publicStoreId))
			.limit(1);
		expect(publicRow).toBeUndefined();
	});

	it("disconnects a public connection while the vault is locked", async () => {
		stubItunes();
		const imp = await app.handle(
			authRequest("http://localhost/api/stores/import", {
				body: JSON.stringify({
					url: "https://apps.apple.com/us/app/other/id555555555",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(imp.status).toBe(200);
		const { app: imported } = await imp.json();
		createdStoreIds.push(imported.store.id);

		vaultSession.lock(getTestWorkspaceId());
		try {
			const res = await app.handle(
				authRequest(`http://localhost/api/stores/${imported.store.id}`, {
					method: "DELETE",
				}),
			);
			expect(res.status).toBe(200);
		} finally {
			vaultSession.unlock(getTestWorkspaceId(), TEST_VAULT_DEK);
		}
	});
});

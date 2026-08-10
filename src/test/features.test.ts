import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { authGuard } from "@/modules/auth";
import { featuresController } from "@/modules/features";
import {
	FEATURE_DEFINITIONS,
	FEATURE_PREFIX,
	type FeatureKey,
	matchesPathPattern,
} from "@/modules/features/features.const";
import { featureGuard } from "@/modules/features/features.guard";
import { historyController } from "@/modules/history";
import { listingsController } from "@/modules/listings";
import { publishingController } from "@/modules/publishing";
import { errorHandler } from "@/utils/errors/errorHandler";
import {
	authRequest,
	authRequestB,
	cleanupSettings,
	getTestWorkspaceIdB,
} from "./setup";

describe("Feature flags", () => {
	const app = new Elysia()
		.use(errorHandler)
		.use(authGuard)
		.group("/api", (app) =>
			app
				.use(featuresController)
				.use(featureGuard)
				.use(publishingController)
				.use(listingsController)
				.use(historyController),
		);

	const FAKE_APP_ID = "00000000-0000-0000-0000-000000000099";
	const allStorageKeys = FEATURE_DEFINITIONS.map(
		(d) => `${FEATURE_PREFIX}${d.key}`,
	);

	afterAll(async () => {
		await cleanupSettings(allStorageKeys);
		await cleanupSettings(allStorageKeys, getTestWorkspaceIdB());
	});

	it("GET /api/features returns all features enabled by default", async () => {
		// Ensure clean slate for workspace A
		await cleanupSettings(allStorageKeys);

		const res = await app.handle(authRequest("http://localhost/api/features"));
		expect(res.status).toBe(200);

		const data = (await res.json()) as {
			definitions: typeof FEATURE_DEFINITIONS;
			features: Record<FeatureKey, boolean>;
		};

		expect(Array.isArray(data.definitions)).toBe(true);
		expect(data.definitions.length).toBe(FEATURE_DEFINITIONS.length);

		// Each feature reports its own default (most are on; MULTI_STORE is off).
		for (const def of FEATURE_DEFINITIONS) {
			expect(data.features[def.key]).toBe(def.defaultEnabled);
		}
	});

	it("PATCH toggles a feature flag and persists it", async () => {
		await cleanupSettings(allStorageKeys);

		const patchRes = await app.handle(
			authRequest("http://localhost/api/features", {
				body: JSON.stringify({ LISTINGS: false }),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);
		expect(patchRes.status).toBe(200);

		const patchData = (await patchRes.json()) as {
			features: Record<FeatureKey, boolean>;
		};
		expect(patchData.features.LISTINGS).toBe(false);
		expect(patchData.features.PUBLISHING).toBe(true);

		const getRes = await app
			.handle(authRequest("http://localhost/api/features"))
			.then(
				(r) =>
					r.json() as Promise<{
						features: Record<FeatureKey, boolean>;
					}>,
			);
		expect(getRes.features.LISTINGS).toBe(false);
		expect(getRes.features.REVIEWS).toBe(true);

		// Cleanup: re-enable
		await cleanupSettings(allStorageKeys);
	});

	it("workspace B cannot see workspace A feature toggles", async () => {
		await cleanupSettings(allStorageKeys);
		await cleanupSettings(allStorageKeys, getTestWorkspaceIdB());

		// Workspace A disables LISTINGS
		await app.handle(
			authRequest("http://localhost/api/features", {
				body: JSON.stringify({ LISTINGS: false }),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);

		// Workspace B should still see LISTINGS = true
		const resB = await app
			.handle(authRequestB("http://localhost/api/features"))
			.then(
				(r) =>
					r.json() as Promise<{
						features: Record<FeatureKey, boolean>;
					}>,
			);
		expect(resB.features.LISTINGS).toBe(true);

		// Workspace A still sees LISTINGS = false
		const resA = await app
			.handle(authRequest("http://localhost/api/features"))
			.then(
				(r) =>
					r.json() as Promise<{
						features: Record<FeatureKey, boolean>;
					}>,
			);
		expect(resA.features.LISTINGS).toBe(false);

		await cleanupSettings(allStorageKeys);
		await cleanupSettings(allStorageKeys, getTestWorkspaceIdB());
	});

	it("returns 403 when disabled feature is accessed", async () => {
		await cleanupSettings(allStorageKeys);

		// Disable PUBLISHING for workspace A
		await app.handle(
			authRequest("http://localhost/api/features", {
				body: JSON.stringify({ PUBLISHING: false }),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);

		// Try to hit a publishing endpoint
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${FAKE_APP_ID}/publishing/push-preview`,
			),
		);

		expect(res.status).toBe(403);
		const body = (await res.json()) as {
			code?: string;
			data?: { info?: string };
		};
		expect(body.code).toBe("FORBIDDEN");
		expect(body.data?.info).toContain("PUBLISHING");

		await cleanupSettings(allStorageKeys);
	});

	it("cascading dependsOn — disabling AI also disables MONETIZATION_CHAT", async () => {
		await cleanupSettings(allStorageKeys);

		await app.handle(
			authRequest("http://localhost/api/features", {
				body: JSON.stringify({ AI: false }),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);

		const res = await app
			.handle(authRequest("http://localhost/api/features"))
			.then(
				(r) =>
					r.json() as Promise<{
						features: Record<FeatureKey, boolean>;
					}>,
			);

		expect(res.features.AI).toBe(false);
		expect(res.features.MONETIZATION_CHAT).toBe(false);
		expect(res.features.PURCHASES).toBe(true);

		await cleanupSettings(allStorageKeys);
	});

	it("cascading dependsOn — re-enabling AI restores MONETIZATION_CHAT", async () => {
		await cleanupSettings(allStorageKeys);

		await app.handle(
			authRequest("http://localhost/api/features", {
				body: JSON.stringify({ AI: false }),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);
		await app.handle(
			authRequest("http://localhost/api/features", {
				body: JSON.stringify({ AI: true }),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);

		const res = await app
			.handle(authRequest("http://localhost/api/features"))
			.then(
				(r) =>
					r.json() as Promise<{
						features: Record<FeatureKey, boolean>;
					}>,
			);

		expect(res.features.AI).toBe(true);
		expect(res.features.MONETIZATION_CHAT).toBe(true);

		await cleanupSettings(allStorageKeys);
	});

	it("re-enabling a feature removes the 403 gate", async () => {
		await cleanupSettings(allStorageKeys);

		// Disable then re-enable PUBLISHING
		await app.handle(
			authRequest("http://localhost/api/features", {
				body: JSON.stringify({ PUBLISHING: false }),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);
		await app.handle(
			authRequest("http://localhost/api/features", {
				body: JSON.stringify({ PUBLISHING: true }),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${FAKE_APP_ID}/publishing/push-preview`,
			),
		);

		// No longer 403 with feature-disabled; now hits ownership/notFound check
		expect(res.status).not.toBe(403);
		if (res.status === 403) {
			const body = (await res.json()) as { data?: { info?: string } };
			expect(body.data?.info ?? "").not.toContain("PUBLISHING is disabled");
		}

		await cleanupSettings(allStorageKeys);
	});

	it("LISTINGS=false blocks GET /apps/:id/listings/diffs", async () => {
		await cleanupSettings(allStorageKeys);

		await app.handle(
			authRequest("http://localhost/api/features", {
				body: JSON.stringify({ LISTINGS: false }),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);

		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${FAKE_APP_ID}/listings/diffs`),
		);

		expect(res.status).toBe(403);
		const body = (await res.json()) as {
			code?: string;
			data?: { info?: string };
		};
		expect(body.code).toBe("FORBIDDEN");
		expect(body.data?.info).toContain("LISTINGS");

		await cleanupSettings(allStorageKeys);
	});

	it("HISTORY=false blocks GET /apps/:id/history", async () => {
		await cleanupSettings(allStorageKeys);

		await app.handle(
			authRequest("http://localhost/api/features", {
				body: JSON.stringify({ HISTORY: false }),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);

		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${FAKE_APP_ID}/history`),
		);

		expect(res.status).toBe(403);
		const body = (await res.json()) as {
			code?: string;
			data?: { info?: string };
		};
		expect(body.code).toBe("FORBIDDEN");
		expect(body.data?.info).toContain("HISTORY");

		await cleanupSettings(allStorageKeys);
	});
});

describe("matchesPathPattern", () => {
	it("matches exact path", () => {
		expect(matchesPathPattern("/api/listings", "/listings")).toBe(true);
	});

	it("matches when pattern is a path prefix segment", () => {
		expect(
			matchesPathPattern("/api/apps/123/listings/categories", "/listings"),
		).toBe(true);
	});

	it("matches multi-segment pattern as contiguous subsequence", () => {
		expect(
			matchesPathPattern(
				"/api/apps/123/listings/categories",
				"/listings/categories",
			),
		).toBe(true);
	});

	it("does NOT match when segment text is a substring of another segment", () => {
		// Regression: "/api/ai" must NOT match "/api/ai-chat-history"
		expect(matchesPathPattern("/api/ai-chat-history", "/ai")).toBe(false);
		expect(matchesPathPattern("/api/listings-other", "/listings")).toBe(false);
		expect(matchesPathPattern("/api/app-groups/x", "/groups")).toBe(false);
	});

	it("matches /ai segment in nested routes", () => {
		expect(matchesPathPattern("/api/ai", "/ai")).toBe(true);
		expect(matchesPathPattern("/api/ai/generate", "/ai")).toBe(true);
		expect(matchesPathPattern("/api/apps/123/ai/translate", "/ai")).toBe(true);
	});

	it("returns false when pattern is longer than path", () => {
		expect(matchesPathPattern("/api/x", "/listings/categories")).toBe(false);
	});

	it("returns false for empty pattern", () => {
		expect(matchesPathPattern("/api/anything", "")).toBe(false);
	});
});

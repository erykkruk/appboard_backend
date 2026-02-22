import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { publishingController } from "@/modules/publishing";

describe("Publishing localizations endpoints", () => {
	const app = new Elysia().group("/api", (app) =>
		app.use(publishingController),
	);

	const FAKE_UUID = "00000000-0000-0000-0000-000000000000";
	const FAKE_VERSION_ID = "fake-version-123";
	const FAKE_LOC_ID = "fake-loc-456";

	// ── POST (add localization) ──────────────────────────────────────────

	describe("POST /api/apps/:appId/publishing/versions/:versionId/localizations", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/not-a-uuid/publishing/versions/${FAKE_VERSION_ID}/localizations`,
					{
						body: JSON.stringify({ locale: "en-US" }),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					},
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 422 when locale is missing from body", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/localizations`,
					{
						body: JSON.stringify({}),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					},
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 422 when locale is empty string", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/localizations`,
					{
						body: JSON.stringify({ locale: "" }),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					},
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/localizations`,
					{
						body: JSON.stringify({ locale: "en-US" }),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					},
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── PATCH (update localization) ──────────────────────────────────────

	describe("PATCH /api/apps/:appId/publishing/versions/:versionId/localizations/:localizationId", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/not-a-uuid/publishing/versions/${FAKE_VERSION_ID}/localizations/${FAKE_LOC_ID}`,
					{
						body: JSON.stringify({ description: "test" }),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 422 when versionId is empty", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions//localizations/${FAKE_LOC_ID}`,
					{
						body: JSON.stringify({ description: "test" }),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			// Empty path segment → route won't match → 404
			expect(res.status).toBe(404);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/localizations/${FAKE_LOC_ID}`,
					{
						body: JSON.stringify({ description: "Updated desc" }),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			expect(res.status).toBe(404);
		});

		it("accepts empty body (no fields to update)", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/localizations/${FAKE_LOC_ID}`,
					{
						body: JSON.stringify({}),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			// Empty body is valid — all fields are optional
			// Should still fail with 404 (app not found), not 422 (validation)
			expect(res.status).toBe(404);
		});

		it("accepts all valid field names", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/localizations/${FAKE_LOC_ID}`,
					{
						body: JSON.stringify({
							description: "A description",
							keywords: "key1, key2",
							marketingUrl: "https://example.com",
							promotionalText: "Promo text",
							subtitle: "A subtitle",
							supportUrl: "https://support.example.com",
							title: "App Title",
							whatsNew: "Bug fixes",
						}),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			// All fields accepted — fails only because app doesn't exist
			expect(res.status).toBe(404);
		});

		it("returns 422 when body contains non-string field value", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/localizations/${FAKE_LOC_ID}`,
					{
						body: JSON.stringify({ description: 12345 }),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			expect(res.status).toBe(422);
		});
	});

	// ── DELETE (remove localization) ─────────────────────────────────────

	describe("DELETE /api/apps/:appId/publishing/versions/:versionId/localizations/:localizationId", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/not-a-uuid/publishing/versions/${FAKE_VERSION_ID}/localizations/${FAKE_LOC_ID}`,
					{ method: "DELETE" },
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/localizations/${FAKE_LOC_ID}`,
					{ method: "DELETE" },
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── GET (version detail / localizations) ─────────────────────────────

	describe("GET /api/apps/:appId/publishing/versions/:versionId", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/not-a-uuid/publishing/versions/${FAKE_VERSION_ID}`,
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}`,
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── GET (list versions) ──────────────────────────────────────────────

	describe("GET /api/apps/:appId/publishing/versions", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request("http://localhost/api/apps/not-a-uuid/publishing/versions"),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions`,
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── GET (version screenshots) ────────────────────────────────────────

	describe("GET /api/apps/:appId/publishing/versions/:versionId/screenshots", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/not-a-uuid/publishing/versions/${FAKE_VERSION_ID}/screenshots`,
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/screenshots`,
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── DELETE screenshot ────────────────────────────────────────────────

	describe("DELETE /api/apps/:appId/publishing/screenshots/:screenshotId", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request(
					"http://localhost/api/apps/not-a-uuid/publishing/screenshots/fake-ss-id",
					{ method: "DELETE" },
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/screenshots/fake-ss-id`,
					{ method: "DELETE" },
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── PATCH reorder screenshots ────────────────────────────────────────

	describe("PATCH /api/apps/:appId/publishing/screenshots/reorder", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request(
					"http://localhost/api/apps/not-a-uuid/publishing/screenshots/reorder",
					{
						body: JSON.stringify({
							screenshotIds: ["a", "b"],
							screenshotSetId: "set-1",
						}),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 422 when body is missing required fields", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/screenshots/reorder`,
					{
						body: JSON.stringify({}),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/screenshots/reorder`,
					{
						body: JSON.stringify({
							screenshotIds: ["a", "b"],
							screenshotSetId: "set-1",
						}),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── DELETE all screenshots (screenshot set) ──────────────────────────

	describe("DELETE /api/apps/:appId/publishing/screenshot-sets/:screenshotSetId", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request(
					"http://localhost/api/apps/not-a-uuid/publishing/screenshot-sets/set-1",
					{ method: "DELETE" },
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/screenshot-sets/set-1`,
					{ method: "DELETE" },
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── PATCH (update localization — empty string fields) ───────────────

	describe("PATCH localizations — empty string field values", () => {
		it("accepts empty string for description (null-check, not truthy)", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/localizations/${FAKE_LOC_ID}`,
					{
						body: JSON.stringify({ description: "" }),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			// Empty string is valid — should fail with 404 (app not found), not 422
			expect(res.status).toBe(404);
		});

		it("accepts empty string for title and subtitle simultaneously", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/localizations/${FAKE_LOC_ID}`,
					{
						body: JSON.stringify({ subtitle: "", title: "" }),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			expect(res.status).toBe(404);
		});

		it("accepts empty string for all optional fields at once", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/localizations/${FAKE_LOC_ID}`,
					{
						body: JSON.stringify({
							description: "",
							keywords: "",
							marketingUrl: "",
							promotionalText: "",
							subtitle: "",
							supportUrl: "",
							title: "",
							whatsNew: "",
						}),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── POST publish-localizations ──────────────────────────────────────

	describe("POST /api/apps/:appId/publishing/versions/:versionId/publish-localizations", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/not-a-uuid/publishing/versions/${FAKE_VERSION_ID}/publish-localizations`,
					{ method: "POST" },
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/publish-localizations`,
					{ method: "POST" },
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── PATCH copyright ─────────────────────────────────────────────────

	describe("PATCH /api/apps/:appId/publishing/versions/:versionId/copyright", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/not-a-uuid/publishing/versions/${FAKE_VERSION_ID}/copyright`,
					{
						body: JSON.stringify({ copyright: "© 2024" }),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 422 when copyright exceeds 255 characters", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/copyright`,
					{
						body: JSON.stringify({ copyright: "x".repeat(256) }),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 422 when copyright is missing from body", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/copyright`,
					{
						body: JSON.stringify({}),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/versions/${FAKE_VERSION_ID}/copyright`,
					{
						body: JSON.stringify({ copyright: "© 2024 Test Corp" }),
						headers: { "Content-Type": "application/json" },
						method: "PATCH",
					},
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── POST sync-versions ──────────────────────────────────────────────

	describe("POST /api/apps/:appId/publishing/sync-versions", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request(
					"http://localhost/api/apps/not-a-uuid/publishing/sync-versions",
					{ method: "POST" },
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/sync-versions`,
					{ method: "POST" },
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── POST submit for review ───────────────────────────────────────────

	describe("POST /api/apps/:appId/publishing/submit-review", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request(
					"http://localhost/api/apps/not-a-uuid/publishing/submit-review",
					{ method: "POST" },
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/submit-review`,
					{ method: "POST" },
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── POST create version ──────────────────────────────────────────────

	describe("POST /api/apps/:appId/publishing/create-version", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request(
					"http://localhost/api/apps/not-a-uuid/publishing/create-version",
					{
						body: JSON.stringify({ versionString: "1.0.0" }),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					},
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 422 when versionString is missing", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/create-version`,
					{
						body: JSON.stringify({}),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					},
				),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/create-version`,
					{
						body: JSON.stringify({ versionString: "1.0.0" }),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					},
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── GET overview ─────────────────────────────────────────────────────

	describe("GET /api/apps/:appId/publishing/overview", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request("http://localhost/api/apps/not-a-uuid/publishing/overview"),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/overview`,
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── POST publish ─────────────────────────────────────────────────────

	describe("POST /api/apps/:appId/publishing/publish", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request("http://localhost/api/apps/not-a-uuid/publishing/publish", {
					method: "POST",
				}),
			);

			expect(res.status).toBe(422);
		});

		it("returns 404 when app does not exist", async () => {
			const res = await app.handle(
				new Request(
					`http://localhost/api/apps/${FAKE_UUID}/publishing/publish`,
					{ method: "POST" },
				),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── GET version info ─────────────────────────────────────────────────

	describe("GET /api/apps/:appId/publishing/version", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				new Request("http://localhost/api/apps/not-a-uuid/publishing/version"),
			);

			expect(res.status).toBe(422);
		});
	});
});

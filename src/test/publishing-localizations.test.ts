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
});

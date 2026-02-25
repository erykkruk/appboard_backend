import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { publishingController } from "@/modules/publishing";
import { authGuard, authRequest } from "@/test/setup";

/**
 * Tests for the screenshot copy endpoint.
 * Since copy/split-upload require a real ASC connection with valid apps,
 * we test validation logic: missing params, invalid UUIDs, non-existent apps.
 */
describe("Screenshot copy endpoint validation", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(publishingController));

	const fakeAppId = "00000000-0000-0000-0000-000000000000";

	test("POST /screenshots/copy returns 404 for non-existent app", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${fakeAppId}/publishing/screenshots/copy`,
				{
					body: JSON.stringify({
						sourceLanguage: "en-US",
						targetLanguage: "pl",
						versionId: "v1",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(404);
	});

	test("POST /screenshots/copy requires sourceLanguage", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${fakeAppId}/publishing/screenshots/copy`,
				{
					body: JSON.stringify({
						targetLanguage: "pl",
						versionId: "v1",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);

		// Elysia returns 422 for validation errors
		expect(res.status).toBe(422);
	});

	test("POST /screenshots/copy requires targetLanguage", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${fakeAppId}/publishing/screenshots/copy`,
				{
					body: JSON.stringify({
						sourceLanguage: "en-US",
						versionId: "v1",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(422);
	});

	test("POST /screenshots/copy requires versionId", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${fakeAppId}/publishing/screenshots/copy`,
				{
					body: JSON.stringify({
						sourceLanguage: "en-US",
						targetLanguage: "pl",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(422);
	});

	test("POST /screenshots/copy rejects invalid appId format", async () => {
		const res = await app.handle(
			authRequest(
				"http://localhost/api/apps/not-a-uuid/publishing/screenshots/copy",
				{
					body: JSON.stringify({
						sourceLanguage: "en-US",
						targetLanguage: "pl",
						versionId: "v1",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(422);
	});
});

describe("Screenshot split-upload endpoint validation", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(publishingController));

	const fakeAppId = "00000000-0000-0000-0000-000000000000";

	test("POST /screenshots/split-upload returns error for non-existent app", async () => {
		const formData = new FormData();
		formData.append(
			"file",
			new File(["fake"], "test.png", { type: "image/png" }),
		);
		formData.append("versionId", "v1");
		formData.append("language", "en-US");
		formData.append("displayType", "APP_IPHONE_65");
		formData.append("parts", "3");

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${fakeAppId}/publishing/screenshots/split-upload`,
				{
					body: formData,
					method: "POST",
				},
			),
		);

		// With a fake file, sharp fails before app check → 400 or 500
		// With a real image, it would be 404 for non-existent app
		expect(res.ok).toBe(false);
	});

	test("POST /screenshots/split-upload rejects invalid appId format", async () => {
		const formData = new FormData();
		formData.append(
			"file",
			new File(["fake"], "test.png", { type: "image/png" }),
		);
		formData.append("versionId", "v1");
		formData.append("language", "en-US");
		formData.append("displayType", "APP_IPHONE_65");
		formData.append("parts", "3");

		const res = await app.handle(
			authRequest(
				"http://localhost/api/apps/not-a-uuid/publishing/screenshots/split-upload",
				{
					body: formData,
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(422);
	});
});

describe("Screenshot split-preview endpoint validation", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(publishingController));

	const fakeAppId = "00000000-0000-0000-0000-000000000000";

	test("POST /screenshots/split-preview rejects invalid appId format", async () => {
		const formData = new FormData();
		formData.append(
			"file",
			new File(["fake"], "test.png", { type: "image/png" }),
		);
		formData.append("displayType", "APP_IPHONE_65");
		formData.append("parts", "3");

		const res = await app.handle(
			authRequest(
				"http://localhost/api/apps/not-a-uuid/publishing/screenshots/split-preview",
				{
					body: formData,
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(422);
	});

	test("POST /screenshots/split-preview requires file", async () => {
		const formData = new FormData();
		formData.append("displayType", "APP_IPHONE_65");
		formData.append("parts", "3");

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${fakeAppId}/publishing/screenshots/split-preview`,
				{
					body: formData,
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(422);
	});

	test("POST /screenshots/split-preview requires displayType", async () => {
		const formData = new FormData();
		formData.append(
			"file",
			new File(["fake"], "test.png", { type: "image/png" }),
		);
		formData.append("parts", "3");

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${fakeAppId}/publishing/screenshots/split-preview`,
				{
					body: formData,
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(422);
	});

	test("POST /screenshots/split-preview requires parts", async () => {
		const formData = new FormData();
		formData.append(
			"file",
			new File(["fake"], "test.png", { type: "image/png" }),
		);
		formData.append("displayType", "APP_IPHONE_65");

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${fakeAppId}/publishing/screenshots/split-preview`,
				{
					body: formData,
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(422);
	});
});

describe("Add localization with copyScreenshotsFrom validation", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(publishingController));

	const fakeAppId = "00000000-0000-0000-0000-000000000000";

	test("POST /localizations accepts copyScreenshotsFrom parameter", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${fakeAppId}/publishing/versions/v1/localizations`,
				{
					body: JSON.stringify({
						copyScreenshotsFrom: "en-US",
						locale: "pl",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);

		// Should pass validation (404 for non-existent app, not 422)
		expect(res.status).toBe(404);
	});

	test("POST /localizations/translate accepts copyScreenshotsFrom parameter", async () => {
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${fakeAppId}/publishing/versions/v1/localizations/translate`,
				{
					body: JSON.stringify({
						copyScreenshotsFrom: "en-US",
						locale: "pl",
						sourceLocale: "en-US",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);

		// Should pass validation (404 for non-existent app, not 422)
		expect(res.status).toBe(404);
	});
});

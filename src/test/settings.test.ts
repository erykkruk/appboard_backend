import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { settingsController } from "@/modules/settings";
import { authGuard, authRequest, cleanupSettings } from "./setup";

const TEST_KEYS = [
	"APP_THEME",
	"FEATURE_FLAG_A",
	"FEATURE_FLAG_B",
	"OPENROUTER_API_KEY",
];

describe("Settings module", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(settingsController));

	afterAll(async () => {
		await cleanupSettings(TEST_KEYS);
	});

	it("PUT /api/settings/:key sets a setting", async () => {
		const response = await app
			.handle(
				authRequest("http://localhost/api/settings/APP_THEME", {
					body: JSON.stringify({ value: "dark" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		expect(response.success).toBe(true);
		expect(response.key).toBe("APP_THEME");
	});

	it("GET /api/settings/:key gets a setting", async () => {
		const response = await app
			.handle(authRequest("http://localhost/api/settings/APP_THEME"))
			.then((res) => res.json());

		expect(response.setting).toBeDefined();
		expect(response.setting.key).toBe("APP_THEME");
		expect(response.setting.value).toBe("dark");
	});

	it("GET /api/settings lists all settings", async () => {
		const response = await app
			.handle(authRequest("http://localhost/api/settings"))
			.then((res) => res.json());

		expect(response.settings).toBeArray();
		expect(response.settings.length).toBeGreaterThanOrEqual(1);
	});

	it("PATCH /api/settings updates multiple settings", async () => {
		const response = await app
			.handle(
				authRequest("http://localhost/api/settings", {
					body: JSON.stringify({
						FEATURE_FLAG_A: "enabled",
						FEATURE_FLAG_B: "disabled",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PATCH",
				}),
			)
			.then((res) => res.json());

		expect(response.updated).toBe(2);
	});

	it("PUT /api/settings/OPENROUTER_API_KEY encrypts sensitive values", async () => {
		await app.handle(
			authRequest("http://localhost/api/settings/OPENROUTER_API_KEY", {
				body: JSON.stringify({ value: "test-key-12345" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		// The list endpoint should mask encrypted values
		const listRes = await app
			.handle(authRequest("http://localhost/api/settings"))
			.then((res) => res.json());

		const apiKeySetting = listRes.settings.find(
			(s: { key: string }) => s.key === "OPENROUTER_API_KEY",
		);
		expect(apiKeySetting).toBeDefined();
		expect(apiKeySetting.value).toBe("********");
		expect(apiKeySetting.isEncrypted).toBe(true);

		// The get endpoint should decrypt it
		const getRes = await app
			.handle(authRequest("http://localhost/api/settings/OPENROUTER_API_KEY"))
			.then((res) => res.json());

		expect(getRes.setting.value).toBe("test-key-12345");
	});
});

import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { settingsController } from "@/modules/settings";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupSettings,
	getTestWorkspaceIdB,
} from "./setup";

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
		await cleanupSettings(TEST_KEYS, getTestWorkspaceIdB());
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

	it("PATCH with masked value '********' does not overwrite encrypted key", async () => {
		// First, set a real key
		await app.handle(
			authRequest("http://localhost/api/settings/OPENROUTER_API_KEY", {
				body: JSON.stringify({ value: "real-secret-key" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		// Now PATCH with masked value (simulating frontend sending back masked data)
		await app.handle(
			authRequest("http://localhost/api/settings", {
				body: JSON.stringify({ OPENROUTER_API_KEY: "********" }),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);

		// The original value should still be intact
		const getRes = await app
			.handle(authRequest("http://localhost/api/settings/OPENROUTER_API_KEY"))
			.then((res) => res.json());

		expect(getRes.setting.value).toBe("real-secret-key");
	});

	it("PUT /api/settings/:key overwrites existing value", async () => {
		await app.handle(
			authRequest("http://localhost/api/settings/APP_THEME", {
				body: JSON.stringify({ value: "light" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		const response = await app
			.handle(authRequest("http://localhost/api/settings/APP_THEME"))
			.then((res) => res.json());

		expect(response.setting.value).toBe("light");
	});

	it("encrypted key persists after re-reading", async () => {
		// Set the key
		await app.handle(
			authRequest("http://localhost/api/settings/OPENROUTER_API_KEY", {
				body: JSON.stringify({ value: "persist-test-key-999" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		// Read it back multiple times to verify persistence
		for (let i = 0; i < 3; i++) {
			const res = await app
				.handle(authRequest("http://localhost/api/settings/OPENROUTER_API_KEY"))
				.then((r) => r.json());

			expect(res.setting.value).toBe("persist-test-key-999");
		}
	});

	describe("workspace isolation", () => {
		it("workspace B cannot see workspace A settings", async () => {
			// Set a value in workspace A
			await app.handle(
				authRequest("http://localhost/api/settings/APP_THEME", {
					body: JSON.stringify({ value: "dark" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			);

			// Workspace B should get a 404
			const res = await app.handle(
				authRequestB("http://localhost/api/settings/APP_THEME"),
			);

			expect(res.status).toBe(404);
		});

		it("workspace B settings are independent from workspace A", async () => {
			// Set different values in each workspace
			await app.handle(
				authRequest("http://localhost/api/settings/APP_THEME", {
					body: JSON.stringify({ value: "dark" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			);

			await app.handle(
				authRequestB("http://localhost/api/settings/APP_THEME", {
					body: JSON.stringify({ value: "light" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			);

			// Each workspace gets its own value
			const resA = await app
				.handle(authRequest("http://localhost/api/settings/APP_THEME"))
				.then((r) => r.json());
			const resB = await app
				.handle(authRequestB("http://localhost/api/settings/APP_THEME"))
				.then((r) => r.json());

			expect(resA.setting.value).toBe("dark");
			expect(resB.setting.value).toBe("light");
		});

		it("workspace B encrypted key is independent from workspace A", async () => {
			// Set different API keys per workspace
			await app.handle(
				authRequest("http://localhost/api/settings/OPENROUTER_API_KEY", {
					body: JSON.stringify({ value: "workspace-a-key" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			);

			await app.handle(
				authRequestB("http://localhost/api/settings/OPENROUTER_API_KEY", {
					body: JSON.stringify({ value: "workspace-b-key" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			);

			const resA = await app
				.handle(authRequest("http://localhost/api/settings/OPENROUTER_API_KEY"))
				.then((r) => r.json());
			const resB = await app
				.handle(
					authRequestB("http://localhost/api/settings/OPENROUTER_API_KEY"),
				)
				.then((r) => r.json());

			expect(resA.setting.value).toBe("workspace-a-key");
			expect(resB.setting.value).toBe("workspace-b-key");
		});

		it("listing settings only returns own workspace", async () => {
			const resA = await app
				.handle(authRequest("http://localhost/api/settings"))
				.then((r) => r.json());
			const resB = await app
				.handle(authRequestB("http://localhost/api/settings"))
				.then((r) => r.json());

			// Both should have settings but they should be different sets
			const aKeys = resA.settings.map((s: { key: string }) => s.key);
			const bKeys = resB.settings.map((s: { key: string }) => s.key);

			// Workspace A has more settings from earlier tests
			expect(aKeys).toContain("APP_THEME");
			expect(bKeys).toContain("APP_THEME");

			// Encrypted values are masked in both
			const aApiKey = resA.settings.find(
				(s: { key: string }) => s.key === "OPENROUTER_API_KEY",
			);
			const bApiKey = resB.settings.find(
				(s: { key: string }) => s.key === "OPENROUTER_API_KEY",
			);
			expect(aApiKey.value).toBe("********");
			expect(bApiKey.value).toBe("********");
		});
	});
});

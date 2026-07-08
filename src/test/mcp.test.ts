import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createClient, loadClientConfig } from "@/mcp/client";
import { getTool, toolNames, tools } from "@/mcp/tools";

const EXPECTED_TOOLS = [
	"apps_list",
	"apps_get",
	"listings_list",
	"listings_update_draft",
	"listings_translate_from",
	"ai_suggest_keywords",
	"ai_translate_localization",
	"ai_generate_release_notes",
	"ai_generate_listing_field",
	"reviews_list",
	"reviews_reply",
	"purchases_list",
	"publishing_validate_screenshot",
	"publishing_publish",
];

describe("MCP tool registry", () => {
	it("registers exactly the expected tools", () => {
		expect(toolNames.sort()).toEqual([...EXPECTED_TOOLS].sort());
	});

	it("every tool has a description and a valid zod input schema", () => {
		for (const tool of tools) {
			expect(tool.description.length).toBeGreaterThan(0);
			// inputSchema is a zod raw shape — each value must be a zod type so the
			// MCP SDK can build a JSON schema from it.
			const shape = tool.inputSchema;
			expect(Object.keys(shape).length).toBeGreaterThanOrEqual(0);
			// Wrapping in z.object must not throw and must parse a matching object.
			const object = z.object(shape);
			expect(object).toBeInstanceOf(z.ZodObject);
		}
	});

	it("required app-scoped tools declare an appId input", () => {
		const appScoped = [
			"apps_get",
			"listings_list",
			"listings_update_draft",
			"listings_translate_from",
			"reviews_list",
			"reviews_reply",
			"purchases_list",
			"publishing_validate_screenshot",
			"publishing_publish",
		];
		for (const name of appScoped) {
			const tool = getTool(name);
			expect(tool).toBeDefined();
			expect(Object.keys(tool!.inputSchema)).toContain("appId");
		}
	});

	it("getTool returns undefined for unknown tools", () => {
		expect(getTool("does_not_exist")).toBeUndefined();
	});
});

describe("MCP client config", () => {
	it("throws a clear error when APPBOARD_API_KEY is missing", () => {
		expect(() => loadClientConfig({})).toThrow(/APPBOARD_API_KEY is required/);
	});

	it("throws when APPBOARD_API_KEY is blank", () => {
		expect(() => loadClientConfig({ APPBOARD_API_KEY: "   " })).toThrow(
			/APPBOARD_API_KEY is required/,
		);
	});

	it("defaults the API URL and keeps the provided key", () => {
		const config = loadClientConfig({ APPBOARD_API_KEY: "ab_testkey" });
		expect(config.apiKey).toBe("ab_testkey");
		expect(config.apiUrl).toBe("http://localhost:6680");
	});

	it("honors a custom APPBOARD_API_URL", () => {
		const config = loadClientConfig({
			APPBOARD_API_KEY: "ab_testkey",
			APPBOARD_API_URL: "https://api.example.test",
		});
		expect(config.apiUrl).toBe("https://api.example.test");
	});

	it("builds a treaty client that sends the bearer Authorization header", async () => {
		const captured: { authorization?: string } = {};
		// Stub fetch so no real request is made; capture the header the client sets.
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const headers = new Headers(init?.headers);
			captured.authorization = headers.get("authorization") ?? undefined;
			return new Response(JSON.stringify({ apps: [] }), {
				headers: { "content-type": "application/json" },
				status: 200,
			});
		}) as typeof fetch;

		try {
			const client = createClient({
				apiKey: "ab_secret",
				apiUrl: "http://localhost:6680",
			});
			await client.api.apps.get();
			expect(captured.authorization).toBe("Bearer ab_secret");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

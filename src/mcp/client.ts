import { treaty } from "@elysiajs/eden";
// Type-only import: pulls in the backend's route types for the typed client
// without importing any runtime code that would boot the Elysia server.
import type { App } from "@/index";

/** Default backend base URL when APPBOARD_API_URL is not provided. */
const DEFAULT_API_URL = "http://localhost:6680";

export type AppBoardClient = ReturnType<typeof treaty<App>>;

export type McpClientConfig = {
	apiKey: string;
	apiUrl: string;
};

/**
 * Read and validate the MCP server configuration from the environment. The API
 * key is required — without it every request would be rejected by the backend,
 * so we fail fast with a clear, actionable message instead.
 */
export function loadClientConfig(
	env: NodeJS.ProcessEnv = process.env,
): McpClientConfig {
	const apiKey = env.APPBOARD_API_KEY?.trim();
	if (!apiKey) {
		throw new Error(
			"APPBOARD_API_KEY is required. Create one via POST /api/auth/api-keys " +
				"(see src/mcp/README.md) and export it as APPBOARD_API_KEY before " +
				"starting the MCP server.",
		);
	}

	const apiUrl = env.APPBOARD_API_URL?.trim() || DEFAULT_API_URL;

	return { apiKey, apiUrl };
}

/**
 * Build the typed Eden treaty client. Every request carries the API key as a
 * bearer token, which the backend's auth guard resolves to a workspace.
 */
export function createClient(config: McpClientConfig): AppBoardClient {
	return treaty<App>(config.apiUrl, {
		headers: {
			authorization: `Bearer ${config.apiKey}`,
		},
	});
}

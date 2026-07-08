import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, loadClientConfig } from "./client";
import { tools } from "./tools";

const SERVER_NAME = "appboard-mcp";
const SERVER_VERSION = "0.1.0";

/**
 * Build the MCP server and register every AppBoard tool. Each tool's handler
 * calls the backend through the shared typed client; results are returned as a
 * single JSON text block, errors as readable MCP error content.
 */
function buildServer(): McpServer {
	const config = loadClientConfig();
	const client = createClient(config);

	const server = new McpServer({
		name: SERVER_NAME,
		version: SERVER_VERSION,
	});

	for (const tool of tools) {
		server.registerTool(
			tool.name,
			{
				description: tool.description,
				inputSchema: tool.inputSchema,
			},
			async (input) => {
				try {
					const result = await tool.handler(client, input);
					return {
						content: [
							{ text: JSON.stringify(result, null, 2), type: "text" as const },
						],
					};
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					return {
						content: [{ text: message, type: "text" as const }],
						isError: true,
					};
				}
			},
		);
	}

	return server;
}

async function main(): Promise<void> {
	const server = buildServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	// Never log to stdout — it is the MCP transport. Diagnostics go to stderr.
	process.stderr.write(
		`${SERVER_NAME} v${SERVER_VERSION} ready (${tools.length} tools)\n`,
	);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`Failed to start ${SERVER_NAME}: ${message}\n`);
	process.exit(1);
});

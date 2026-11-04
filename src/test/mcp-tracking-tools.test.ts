import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { createClient } from "@/mcp/client";
import { getTool } from "@/mcp/tools";
import { appsController } from "@/modules/apps";
import { trackingController } from "@/modules/tracking";
import { authGuard, authRequest, cleanupStores } from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { errorHandler } from "@/utils/errors/errorHandler";

/**
 * The MCP tools talk to the backend over HTTP through the typed treaty
 * client. Route that client's fetch into the in-process app (authenticated as
 * workspace A) so each tool is exercised against the real endpoints.
 */
const backend = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(appsController).use(trackingController));

const realFetch = globalThis.fetch;
const storeIds: string[] = [];
let appId: string;

beforeAll(async () => {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		return backend.handle(
			authRequest(request.url, {
				body: request.body ? await request.text() : undefined,
				headers: request.headers,
				method: request.method,
			}),
		);
	}) as typeof fetch;
	const store = await seedTestStore();
	storeIds.push(store.id);
	appId = (await seedTestApp(store.id)).id;
});

afterAll(async () => {
	globalThis.fetch = realFetch;
	await cleanupStores(storeIds);
});

const client = createClient({ apiKey: "ab_test", apiUrl: "http://localhost" });

async function call(name: string, input: unknown) {
	const tool = getTool(name);
	if (!tool) throw new Error(`missing tool ${name}`);
	return tool.handler(client, input);
}

describe("MCP tracking tools against the real endpoints", () => {
	it("adds keywords in bulk, reads markets and the board, removes by phrase", async () => {
		const added = (await call("tracking_add_keywords", {
			appId,
			items: [
				{ country: "us", keywords: ["party game", "trivia"] },
				{ country: "de", keywords: ["partyspiel"] },
			],
		})) as { totals: { added: number } };
		expect(added.totals.added).toBe(3);

		const markets = (await call("tracking_get_markets", { appId })) as {
			markets: Array<{ country: string; tracked: number }>;
		};
		expect(markets.markets).toEqual([
			expect.objectContaining({ country: "de", tracked: 1 }),
			expect.objectContaining({ country: "us", tracked: 2 }),
		]);

		const board = (await call("tracking_get_board", {
			appId,
			country: "us",
		})) as { country: string; keywords: unknown[] };
		expect(board.country).toBe("us");
		expect(board.keywords.length).toBe(2);

		const star = (await call("tracking_star_keywords", {
			appId,
			items: [{ country: "US", keywords: ["Party Game", "not tracked"] }],
		})) as {
			results: Array<{
				country: string;
				notTracked: string[];
				updated: string[];
			}>;
			totals: { notTracked: number; updated: number };
		};
		expect(star.totals).toEqual({ notTracked: 1, updated: 1 });
		expect(star.results[0]).toEqual({
			country: "us",
			notTracked: ["not tracked"],
			updated: ["party game"],
		});
		const starredBoard = (await call("tracking_get_board", {
			appId,
			country: "us",
		})) as { keywords: Array<{ keyword: string; starred: boolean }> };
		expect(
			starredBoard.keywords.filter((k) => k.starred).map((k) => k.keyword),
		).toEqual(["party game"]);

		const removed = (await call("tracking_remove_keyword", {
			appId,
			country: "US",
			keyword: "Trivia",
		})) as { success: boolean };
		expect(removed.success).toBe(true);

		await expect(
			call("tracking_remove_keyword", {
				appId,
				country: "us",
				keyword: "nope",
			}),
		).rejects.toThrow(/not tracked/);
	});

	it("updates the tracking config and reports check status", async () => {
		const updated = (await call("tracking_update_config", {
			appId,
			rankTrackingEnabled: true,
		})) as { config: { rankTrackingEnabled: boolean } };
		expect(updated.config.rankTrackingEnabled).toBe(true);

		const status = (await call("tracking_check_status", { appId })) as {
			run: unknown;
		};
		expect(status.run).toBeNull();
	});

	it("updates devices", async () => {
		const result = (await call("apps_update_devices", {
			appId,
			devices: ["tv"],
		})) as { app: { devices: string[] } };
		expect(result.app.devices).toEqual(["tv"]);
	});

	it("surfaces backend errors with the status", async () => {
		await expect(
			call("tracking_get_markets", {
				appId: "00000000-0000-0000-0000-000000000000",
			}),
		).rejects.toThrow(/AppBoard API error \(404\)/);
	});
});

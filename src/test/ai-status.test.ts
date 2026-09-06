import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { aiController } from "@/modules/ai";
import { AiErrors } from "@/modules/ai/ai-errors";
import { settingsController } from "@/modules/settings";
import { errorHandler } from "@/utils/errors/errorHandler";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupSettings,
	getTestWorkspaceId,
	getTestWorkspaceIdB,
} from "./setup";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(aiController).use(settingsController));

type Status = {
	configured: boolean;
	lastError: string | null;
	source: "workspace" | "instance" | null;
};

async function status(req = authRequest) {
	const res = await app.handle(req("http://localhost/api/ai/status"));
	return (await res.json()) as Status;
}

describe("AI status", () => {
	afterAll(async () => {
		await cleanupSettings(["OPENROUTER_API_KEY"]);
		AiErrors.clear(getTestWorkspaceId());
		AiErrors.clear(getTestWorkspaceIdB());
	});

	it("reports the last OpenRouter failure and forgets it when a new key is saved", async () => {
		AiErrors.set(getTestWorkspaceId(), "OpenRouter rejected the key");
		await app.handle(
			authRequest("http://localhost/api/settings", {
				body: JSON.stringify({ openrouter_api_key: "sk-or-old" }),
				headers: { "content-type": "application/json" },
				method: "PATCH",
			}),
		);
		// The error is set after the key so the save above does not clear it.
		AiErrors.set(getTestWorkspaceId(), "OpenRouter rejected the key");

		expect(await status()).toMatchObject({
			configured: true,
			lastError: "OpenRouter rejected the key",
			source: "workspace",
		});

		const saved = await app.handle(
			authRequest("http://localhost/api/settings", {
				body: JSON.stringify({ openrouter_api_key: "sk-or-new" }),
				headers: { "content-type": "application/json" },
				method: "PATCH",
			}),
		);
		expect(saved.status).toBe(200);
		expect((await status()).lastError).toBeNull();
	});

	it("keeps failures per workspace", async () => {
		AiErrors.set(getTestWorkspaceId(), "OpenRouter error 500");
		expect((await status(authRequestB)).lastError).toBeNull();
	});
});

import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { aiController } from "@/modules/ai";
import { errorHandler } from "@/utils/errors/errorHandler";
import { authGuard, authRequest } from "./setup";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(aiController));

const realFetch = globalThis.fetch;

const CATALOG = {
	data: [
		{
			architecture: {
				input_modalities: ["text", "image"],
				output_modalities: ["text"],
			},
			context_length: 200000,
			id: "anthropic/claude-sonnet-5",
			name: "Anthropic: Claude Sonnet 5",
			pricing: { completion: "0.000015", prompt: "0.000003" },
		},
		{
			architecture: { input_modalities: ["text"], output_modalities: ["text"] },
			id: "anthropic/claude-sonnet-5:batch",
			name: "Anthropic: Claude Sonnet 5 (batch)",
		},
		{
			architecture: {
				input_modalities: ["text"],
				output_modalities: ["audio"],
			},
			id: "google/lyria-3-pro-preview",
			name: "Google: Lyria 3 Pro",
		},
		{
			architecture: { modality: "text->text" },
			context_length: 128000,
			id: "z-ai/glm-5.3",
			name: "Z.ai: GLM 5.3",
			pricing: { completion: "0.000002", prompt: "0.0000005" },
		},
	],
};

describe("GET /api/ai/models", () => {
	afterAll(() => {
		globalThis.fetch = realFetch;
	});

	it("lists text models from the OpenRouter catalog without batch and non-text entries", async () => {
		let calls = 0;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.includes("openrouter.ai/api/v1/models")) {
				calls++;
				return new Response(JSON.stringify(CATALOG), {
					headers: { "content-type": "application/json" },
				});
			}
			return realFetch(input);
		}) as typeof fetch;

		const res = await app.handle(authRequest("http://localhost/api/ai/models"));
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			models: Array<{
				id: string;
				provider: string;
				pricing: { prompt: number };
			}>;
		};
		expect(body.models.map((m) => m.id)).toEqual([
			"anthropic/claude-sonnet-5",
			"z-ai/glm-5.3",
		]);
		expect(body.models[0].provider).toBe("anthropic");
		expect(body.models[0].pricing.prompt).toBeCloseTo(0.000003);

		// Cached: a second read does not hit the catalog again.
		await app.handle(authRequest("http://localhost/api/ai/models"));
		expect(calls).toBe(1);
	});
});

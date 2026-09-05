import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { aiController } from "@/modules/ai";
import { SettingsService } from "@/modules/settings/settings.service";
import { errorHandler } from "@/utils/errors/errorHandler";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupSettings,
	getTestWorkspaceId,
} from "./setup";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(aiController));

const realFetch = globalThis.fetch;
const ROUTE = "http://localhost/api/ai/generate-description";
const BRIEF = "Pomo blocks distracting apps while a focus timer runs.";
const GENERATED =
	"Focus timer for deep work.\n\nBlock distracting apps and track every pomodoro session.";

interface CapturedPrompt {
	systemPrompt: string;
	userPrompt: string;
}

/** Answers as OpenRouter would and records what the model was asked. */
function stubOpenRouter(captured: CapturedPrompt) {
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body)) as {
			messages: Array<{ content: string; role: string }>;
		};
		captured.systemPrompt =
			body.messages.find((m) => m.role === "system")?.content ?? "";
		captured.userPrompt =
			body.messages.find((m) => m.role === "user")?.content ?? "";
		return new Response(
			JSON.stringify({ choices: [{ message: { content: GENERATED } }] }),
			{ headers: { "Content-Type": "application/json" }, status: 200 },
		);
	}) as typeof fetch;
}

function post(body: Record<string, unknown>, request = authRequest) {
	return app.handle(
		request(ROUTE, {
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		}),
	);
}

describe("POST /api/ai/generate-description (write with AI)", () => {
	beforeAll(async () => {
		await SettingsService.set(
			getTestWorkspaceId(),
			"OPENROUTER_API_KEY",
			"test-openrouter-key",
		);
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	afterAll(async () => {
		await cleanupSettings(["OPENROUTER_API_KEY"]);
	});

	it("asks the model for the keywords and the brief, and returns the text under result", async () => {
		const captured: CapturedPrompt = { systemPrompt: "", userPrompt: "" };
		stubOpenRouter(captured);

		const response = await post({
			appName: "Pomo",
			keywords: ["focus timer", " pomodoro ", ""],
			platform: "ios",
			prompt: BRIEF,
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			description: string;
			model: string;
			result: string;
		};
		expect(body.result).toBe(GENERATED);
		expect(body.description).toBe(GENERATED);
		expect(body.model.length).toBeGreaterThan(0);

		expect(captured.systemPrompt.length).toBeGreaterThan(0);
		expect(captured.userPrompt).toContain(BRIEF);
		expect(captured.userPrompt).toContain("- focus timer");
		expect(captured.userPrompt).toContain("- pomodoro");
		expect(captured.userPrompt).not.toContain("- \n");
		expect(captured.userPrompt).toContain("iOS (App Store)");
	});

	it("keeps paragraph breaks in the generated text", async () => {
		stubOpenRouter({ systemPrompt: "", userPrompt: "" });

		const response = await post({ appName: "Pomo", prompt: BRIEF });

		expect(response.status).toBe(200);
		const body = (await response.json()) as { result: string };
		expect(body.result).toContain("\n\n");
	});

	it("addresses Google Play when the platform is android", async () => {
		const captured: CapturedPrompt = { systemPrompt: "", userPrompt: "" };
		stubOpenRouter(captured);

		const response = await post({
			appName: "Pomo",
			platform: "android",
			prompt: BRIEF,
		});

		expect(response.status).toBe(200);
		expect(captured.userPrompt).toContain("Android (Google Play)");
	});

	it("does not let workspace B use workspace A's key", async () => {
		let called = false;
		globalThis.fetch = (async () => {
			called = true;
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		const response = await post(
			{ appName: "Pomo", keywords: ["focus timer"], prompt: BRIEF },
			authRequestB,
		);

		expect(response.status).toBe(400);
		const body = (await response.json()) as { code: string };
		expect(body.code).toBe("BAD_REQUEST");
		expect(called).toBe(false);
	});
});

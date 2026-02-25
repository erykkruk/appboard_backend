import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { aiController } from "@/modules/ai";
import { authGuard, authRequest } from "@/test/setup";

describe("AI module", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(aiController));

	it("POST /api/ai/translate returns error when no API key configured", async () => {
		const response = await app.handle(
			authRequest("http://localhost/api/ai/translate", {
				body: JSON.stringify({
					targetLanguages: ["pl-PL", "de-DE"],
					text: "Hello world",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.code).toBe("BAD_REQUEST");
	});

	it("POST /api/ai/generate-description returns error when no API key configured", async () => {
		const response = await app.handle(
			authRequest("http://localhost/api/ai/generate-description", {
				body: JSON.stringify({
					appName: "TestApp",
					prompt: "helps track fitness goals",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.ok).toBe(false);
	});

	it("POST /api/ai/suggest-keywords returns error when no API key configured", async () => {
		const response = await app.handle(
			authRequest("http://localhost/api/ai/suggest-keywords", {
				body: JSON.stringify({ appName: "FitTrack" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.code).toBe("BAD_REQUEST");
	});

	it("POST /api/ai/draft-reply returns error when no API key configured", async () => {
		const response = await app.handle(
			authRequest("http://localhost/api/ai/draft-reply", {
				body: JSON.stringify({
					authorName: "John",
					rating: 5,
					reviewText: "Great app!",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.code).toBe("BAD_REQUEST");
	});

	it("POST /api/ai/generate-release-notes returns error when no API key configured", async () => {
		const response = await app.handle(
			authRequest("http://localhost/api/ai/generate-release-notes", {
				body: JSON.stringify({
					appName: "TestApp",
					changes: ["Fixed login bug", "Added dark mode"],
					version: "2.0.0",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.ok).toBe(false);
	});

	it("POST /api/ai/translate requires authentication", async () => {
		const response = await app.handle(
			new Request("http://localhost/api/ai/translate", {
				body: JSON.stringify({
					targetLanguages: ["pl-PL"],
					text: "Hello",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(401);
	});
});

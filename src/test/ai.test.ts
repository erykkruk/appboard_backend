import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { aiController } from "@/modules/ai";

describe("AI module", () => {
	const app = new Elysia().group("/api", (app) => app.use(aiController));

	it("POST /api/ai/translate returns mock translations", async () => {
		const response = await app
			.handle(
				new Request("http://localhost/api/ai/translate", {
					body: JSON.stringify({
						targetLanguages: ["pl-PL", "de-DE"],
						text: "Hello world",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		expect(response.mock).toBe(true);
		expect(response.translations).toBeDefined();
		expect(response.translations["pl-PL"]).toBeDefined();
		expect(response.translations["de-DE"]).toBeDefined();
	});

	it("POST /api/ai/generate-description returns mock description", async () => {
		const response = await app
			.handle(
				new Request("http://localhost/api/ai/generate-description", {
					body: JSON.stringify({
						appName: "TestApp",
						prompt: "helps track fitness goals",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		expect(response.mock).toBe(true);
		expect(response.description).toContain("TestApp");
	});

	it("POST /api/ai/suggest-keywords returns mock keywords", async () => {
		const response = await app
			.handle(
				new Request("http://localhost/api/ai/suggest-keywords", {
					body: JSON.stringify({ appName: "FitTrack" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		expect(response.mock).toBe(true);
		expect(response.keywords).toBeArray();
		expect(response.keywords.length).toBeGreaterThan(0);
	});

	it("POST /api/ai/draft-reply returns mock reply for positive review", async () => {
		const response = await app
			.handle(
				new Request("http://localhost/api/ai/draft-reply", {
					body: JSON.stringify({
						authorName: "John",
						rating: 5,
						reviewText: "Great app!",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		expect(response.mock).toBe(true);
		expect(response.reply).toContain("John");
	});

	it("POST /api/ai/draft-reply returns mock reply for negative review", async () => {
		const response = await app
			.handle(
				new Request("http://localhost/api/ai/draft-reply", {
					body: JSON.stringify({
						authorName: "Jane",
						rating: 1,
						reviewText: "Terrible app",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		expect(response.mock).toBe(true);
		expect(response.reply).toContain("Jane");
		expect(response.reply).toContain("sorry");
	});

	it("POST /api/ai/generate-release-notes returns mock release notes", async () => {
		const response = await app
			.handle(
				new Request("http://localhost/api/ai/generate-release-notes", {
					body: JSON.stringify({
						appName: "TestApp",
						changes: ["Fixed login bug", "Added dark mode"],
						version: "2.0.0",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		expect(response.mock).toBe(true);
		expect(response.releaseNotes).toContain("TestApp");
		expect(response.releaseNotes).toContain("2.0.0");
	});
});

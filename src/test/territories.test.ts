import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { ASC_TERRITORIES } from "@/config/const";
import { monetizationChatController } from "@/modules/ai/monetization-chat.controller";
import { authGuard, authRequest } from "./setup";

describe("Territories", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(monetizationChatController));

	describe("GET /api/ai/territories", () => {
		it("returns 200 with territories list", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/territories"),
			);

			expect(response.status).toBe(200);

			const body = await response.json();
			expect(body).toHaveProperty("territories");
			expect(Array.isArray(body.territories)).toBe(true);
		});

		it("returns the full list of territories matching ASC_TERRITORIES", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/territories"),
			);
			const body = await response.json();

			expect(body.territories.length).toBe(ASC_TERRITORIES.length);
		});

		it("each territory has code, name, and currency fields", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/territories"),
			);
			const body = await response.json();

			for (const territory of body.territories) {
				expect(territory).toHaveProperty("code");
				expect(territory).toHaveProperty("name");
				expect(territory).toHaveProperty("currency");
				expect(typeof territory.code).toBe("string");
				expect(typeof territory.name).toBe("string");
				expect(typeof territory.currency).toBe("string");
			}
		});

		it("all territory codes are valid ISO-2/ISO-3 codes (2-3 chars)", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/territories"),
			);
			const body = await response.json();

			for (const territory of body.territories) {
				expect(territory.code.length).toBeGreaterThanOrEqual(2);
				expect(territory.code.length).toBeLessThanOrEqual(3);
				expect(territory.code).toMatch(/^[A-Z]{2,3}$/);
			}
		});

		it("all currency codes are valid 3-char codes", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/territories"),
			);
			const body = await response.json();

			for (const territory of body.territories) {
				expect(territory.currency.length).toBe(3);
				expect(territory.currency).toMatch(/^[A-Z]{3}$/);
			}
		});

		it("contains known territories (US, GB, DE, PL, JP)", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/territories"),
			);
			const body = await response.json();

			const codes = body.territories.map((t: { code: string }) => t.code);

			expect(codes).toContain("US");
			expect(codes).toContain("GB");
			expect(codes).toContain("DE");
			expect(codes).toContain("PL");
			expect(codes).toContain("JP");
		});

		it("known territories have correct currencies", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/territories"),
			);
			const body = await response.json();

			const byCode = new Map(
				body.territories.map((t: { code: string; currency: string }) => [
					t.code,
					t.currency,
				]),
			);

			expect(byCode.get("US")).toBe("USD");
			expect(byCode.get("GB")).toBe("GBP");
			expect(byCode.get("DE")).toBe("EUR");
			expect(byCode.get("PL")).toBe("PLN");
			expect(byCode.get("JP")).toBe("JPY");
		});

		it("territories are sorted alphabetically by code", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/territories"),
			);
			const body = await response.json();

			const codes = body.territories.map((t: { code: string }) => t.code);
			const sorted = [...codes].sort();

			expect(codes).toEqual(sorted);
		});

		it("has no duplicate territory codes", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/territories"),
			);
			const body = await response.json();

			const codes = body.territories.map((t: { code: string }) => t.code);
			const unique = new Set(codes);

			expect(unique.size).toBe(codes.length);
		});
	});

	describe("monetization-chat schema: territories field validation", () => {
		const validBase = {
			appId: "00000000-0000-0000-0000-000000000001",
			messages: [{ content: "Hello", role: "user" }],
		};

		it("accepts request with valid territories array", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/monetization-chat", {
					body: JSON.stringify({
						...validBase,
						territories: ["US", "GB", "DE"],
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			);

			// Should not be a 422 validation error
			expect(response.status).not.toBe(422);
		});

		it("accepts request with empty territories array", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/monetization-chat", {
					body: JSON.stringify({
						...validBase,
						territories: [],
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			);

			// Should not be a 422 validation error
			expect(response.status).not.toBe(422);
		});

		it("accepts request without territories field (optional)", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/monetization-chat", {
					body: JSON.stringify(validBase),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			);

			// Should not be a 422 validation error
			expect(response.status).not.toBe(422);
		});

		it("rejects territory codes that are too short (1 char)", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/monetization-chat", {
					body: JSON.stringify({
						...validBase,
						territories: ["U"],
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			);

			expect(response.status).toBe(422);
		});

		it("rejects territory codes that are too long (4+ chars)", async () => {
			const response = await app.handle(
				authRequest("http://localhost/api/ai/monetization-chat", {
					body: JSON.stringify({
						...validBase,
						territories: ["ABCD"],
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			);

			expect(response.status).toBe(422);
		});
	});
});

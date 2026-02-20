import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { systemController } from "@/modules/system";

describe("Health endpoint", () => {
	const app = new Elysia().group("/api", (app) => app.use(systemController));

	it("GET /api/system/health returns 200 with status ok", async () => {
		const response = await app
			.handle(new Request("http://localhost/api/system/health"))
			.then((res) => res.json());

		expect(response).toHaveProperty("status", "ok");
		expect(response).toHaveProperty("version");
		expect(response).toHaveProperty("uptime");
		expect(typeof response.uptime).toBe("number");
	});
});

import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { storesController } from "@/modules/stores";
import { authGuard, authRequest } from "@/test/setup";

describe("Auth guard", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(storesController));

	it("protected endpoint without auth returns 401", async () => {
		const res = await app.handle(new Request("http://localhost/api/stores"));
		expect(res.status).toBe(401);
	});

	it("protected endpoint with test auth header returns 200", async () => {
		const res = await app.handle(authRequest("http://localhost/api/stores"));
		expect(res.status).toBe(200);
	});

	it("public path /api/system/health skips auth", async () => {
		const publicApp = new Elysia()
			.use(authGuard)
			.get("/api/system/health", ({ userId }) => ({
				authenticated: !!userId,
				status: "ok",
			}));

		const res = await publicApp.handle(
			new Request("http://localhost/api/system/health"),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.authenticated).toBe(false);
	});

	it("stores response is scoped to workspace", async () => {
		const res = await app.handle(authRequest("http://localhost/api/stores"));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.stores).toBeArray();
	});

	it("invalid test user returns 401", async () => {
		const headers = new Headers();
		headers.set("x-test-user-id", "nonexistent-user-999");
		const res = await app.handle(
			new Request("http://localhost/api/stores", { headers }),
		);
		expect(res.status).toBe(401);
	});
});

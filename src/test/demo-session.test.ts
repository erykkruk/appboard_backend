import { beforeAll, describe, expect, it } from "bun:test";
import Elysia from "elysia";
import { auth } from "@/config/auth";
import { demoController } from "@/modules/demo";
import { DEMO_ACCOUNT } from "@/modules/demo/demo.const";
import { errorHandler } from "@/utils/errors/errorHandler";

const app = new Elysia().use(errorHandler).use(demoController);

describe("Demo session endpoint", () => {
	beforeAll(async () => {
		// Ensure the demo account exists (idempotent — sign-up errors when the
		// user is already there, which is fine for this test).
		await auth.api
			.signUpEmail({
				body: {
					email: DEMO_ACCOUNT.email,
					name: DEMO_ACCOUNT.name,
					password: DEMO_ACCOUNT.password,
				},
			})
			.catch(() => undefined);
	});

	it("POST /api/demo/session signs into the demo account and sets a session cookie", async () => {
		const res = await app.handle(
			new Request("http://localhost/api/demo/session", { method: "POST" }),
		);
		expect(res.status).toBe(200);
		const setCookie = res.headers.get("set-cookie") ?? "";
		expect(setCookie).toContain("better-auth.session_token");
	});

	it("is a POST-only endpoint", async () => {
		const res = await app.handle(
			new Request("http://localhost/api/demo/session", { method: "GET" }),
		);
		expect(res.status).toBe(404);
	});
});

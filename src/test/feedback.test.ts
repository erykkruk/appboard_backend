import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { feedbackController } from "@/modules/feedback";
import { errorHandler } from "@/utils/errors/errorHandler";

const app = new Elysia().use(errorHandler).use(feedbackController);

function form(fields: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [key, value] of Object.entries(fields)) fd.append(key, value);
	return fd;
}

async function post(body: FormData) {
	return app.handle(
		new Request("http://localhost/api/feedback", { body, method: "POST" }),
	);
}

describe("Feedback endpoint", () => {
	it("is public — no 401", async () => {
		const res = await post(
			form({ email: "user@example.com", feature: "Listings", message: "hi" }),
		);
		expect(res.status).not.toBe(401);
	});

	it("rejects an invalid email (422)", async () => {
		const res = await post(
			form({ email: "not-an-email", feature: "Listings", message: "hi" }),
		);
		expect(res.status).toBe(422);
	});

	it("rejects an empty message (422)", async () => {
		const res = await post(
			form({ email: "user@example.com", feature: "Listings", message: "" }),
		);
		expect(res.status).toBe(422);
	});

	it("returns 503 when no recipient/mailer is configured (test env)", async () => {
		const res = await post(
			form({
				email: "user@example.com",
				feature: "Research & rank tracking",
				message: "Love the rank tracking!",
			}),
		);
		expect(res.status).toBe(503);
	});
});

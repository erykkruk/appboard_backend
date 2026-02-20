import { describe, expect, it } from "bun:test";
import { buildError, errors } from "@/utils/errors";

describe("Error utilities", () => {
	it("buildError throws with correct status and code for notFound", () => {
		try {
			buildError("notFound");
			expect(true).toBe(false); // should not reach here
		} catch (error: unknown) {
			const err = error as { code: string; response: unknown };
			expect(err.response).toEqual({
				code: "NOT_FOUND",
				data: undefined,
			});
		}
	});

	it("buildError throws with correct status and code for badRequest", () => {
		try {
			buildError("badRequest", { info: "Missing field" });
			expect(true).toBe(false);
		} catch (error: unknown) {
			const err = error as { response: unknown };
			expect(err.response).toEqual({
				code: "BAD_REQUEST",
				data: { info: "Missing field" },
			});
		}
	});

	it("buildError throws with correct status and code for unauthorized", () => {
		try {
			buildError("unauthorized");
			expect(true).toBe(false);
		} catch (error: unknown) {
			const err = error as { response: unknown };
			expect(err.response).toEqual({
				code: "UNAUTHORIZED",
				data: undefined,
			});
		}
	});

	it("errors object contains all expected error types", () => {
		const expectedKeys = [
			"badRequest",
			"encryptionFailed",
			"forbidden",
			"notFound",
			"rateLimitExceeded",
			"somethingWentWrong",
			"storeApiError",
			"storeConnectionFailed",
			"unauthorized",
			"validationFailed",
		];
		expect(Object.keys(errors).sort()).toEqual(expectedKeys);
	});
});

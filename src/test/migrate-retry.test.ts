import { describe, expect, it } from "bun:test";
import { isConnectionError } from "@/utils/db/migrate";

describe("isConnectionError", () => {
	it("matches Bun postgres connection-closed errors", () => {
		expect(
			isConnectionError({
				code: "ERR_POSTGRES_CONNECTION_CLOSED",
				message: "Connection closed",
			}),
		).toBe(true);
	});

	it("matches connection errors wrapped by DrizzleQueryError via cause", () => {
		expect(
			isConnectionError({
				cause: { code: "ECONNREFUSED", message: "connect ECONNREFUSED" },
				message: 'Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"',
			}),
		).toBe(true);
	});

	it("matches postgres startup errors", () => {
		expect(
			isConnectionError({
				message: "the database system is starting up",
			}),
		).toBe(true);
	});

	it("rejects genuine SQL errors", () => {
		expect(
			isConnectionError({
				code: "42P01",
				message: 'relation "apps" does not exist',
			}),
		).toBe(false);
	});

	it("rejects non-object errors", () => {
		expect(isConnectionError("boom")).toBe(false);
		expect(isConnectionError(null)).toBe(false);
	});
});

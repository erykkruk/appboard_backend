import { describe, expect, it } from "bun:test";
import {
	computeBackoffMs,
	isRetryableStatus,
	nextDelayMs,
	parseRetryAfterMs,
} from "@/utils/backoff";

describe("backoff", () => {
	it("treats throttling and transient server errors as retryable", () => {
		expect(isRetryableStatus(429)).toBe(true);
		expect(isRetryableStatus(500)).toBe(true);
		expect(isRetryableStatus(503)).toBe(true);

		expect(isRetryableStatus(200)).toBe(false);
		expect(isRetryableStatus(400)).toBe(false);
		expect(isRetryableStatus(404)).toBe(false);
		// 401 is handled by re-minting the token, not by blind retries.
		expect(isRetryableStatus(401)).toBe(false);
		expect(isRetryableStatus(409)).toBe(false);
	});

	it("grows the delay with each attempt", () => {
		const first = computeBackoffMs(1);
		const third = computeBackoffMs(3);

		expect(first).toBeGreaterThanOrEqual(1_000);
		expect(third).toBeGreaterThan(first);
	});

	it("caps the delay so a retry loop cannot stall for minutes", () => {
		expect(computeBackoffMs(20)).toBeLessThanOrEqual(40_000);
	});

	it("jitters, so parallel workers do not retry in lockstep", () => {
		const delays = new Set(
			Array.from({ length: 20 }, () => computeBackoffMs(3)),
		);
		expect(delays.size).toBeGreaterThan(1);
	});

	describe("Retry-After", () => {
		it("parses delay-seconds", () => {
			expect(parseRetryAfterMs("2")).toBe(2_000);
		});

		it("parses an HTTP date", () => {
			const future = new Date(Date.now() + 5_000).toUTCString();
			const parsed = parseRetryAfterMs(future);
			expect(parsed).toBeGreaterThan(2_000);
			expect(parsed).toBeLessThanOrEqual(6_000);
		});

		it("clamps an absurd value instead of stalling the request", () => {
			expect(parseRetryAfterMs("99999")).toBe(60_000);
		});

		it("ignores a missing or unparseable header", () => {
			expect(parseRetryAfterMs(null)).toBeNull();
			expect(parseRetryAfterMs("soon")).toBeNull();
			expect(parseRetryAfterMs("-5")).toBeNull();
		});

		it("wins over exponential backoff when present", () => {
			expect(nextDelayMs(5, "1")).toBe(1_000);
		});

		it("falls back to exponential backoff when absent", () => {
			expect(nextDelayMs(1, null)).toBeGreaterThanOrEqual(1_000);
		});
	});
});

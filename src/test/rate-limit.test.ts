import { beforeEach, describe, expect, it } from "bun:test";
import {
	checkRateLimit,
	rateLimitEnabled,
	resetRateLimits,
} from "@/utils/rate-limit";

describe("rate limiter", () => {
	beforeEach(() => {
		resetRateLimits();
	});

	it("allows hits up to the limit and rejects beyond it", () => {
		for (let i = 0; i < 5; i++) {
			expect(checkRateLimit("k1", 5, 60_000)).toBe(true);
		}
		expect(checkRateLimit("k1", 5, 60_000)).toBe(false);
		expect(checkRateLimit("k1", 5, 60_000)).toBe(false);
	});

	it("tracks keys independently", () => {
		for (let i = 0; i < 5; i++) {
			expect(checkRateLimit("a", 5, 60_000)).toBe(true);
		}
		expect(checkRateLimit("a", 5, 60_000)).toBe(false);
		expect(checkRateLimit("b", 5, 60_000)).toBe(true);
	});

	it("expires hits outside the window", () => {
		expect(checkRateLimit("w", 1, 1)).toBe(true);
		expect(checkRateLimit("w", 1, 1)).toBe(false);
		// After the 1ms window passes, the slot frees up.
		const start = Date.now();
		while (Date.now() - start < 5) {
			// busy-wait a few ms — Bun test has no fake timers here
		}
		expect(checkRateLimit("w", 1, 1)).toBe(true);
	});

	it("is disabled under the test runner", () => {
		expect(rateLimitEnabled()).toBe(false);
	});
});

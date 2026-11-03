import { describe, expect, it } from "bun:test";
import {
	configureRankLookup,
	describeStoreError,
	isRetryableLookup,
	isThrottleStatus,
	lookupRank,
	RANK_LOOKUP_MAX_ATTEMPTS,
	RANK_LOOKUP_MAX_SLOWDOWN,
	RANK_LOOKUP_RECOVERY_STREAK,
	RANK_LOOKUP_SPACING_MS,
	RANK_LOOKUP_THROTTLE_PAUSE_MS,
	rankBackoffMs,
	StoreThrottle,
} from "@/modules/tracking/rank-lookup";
import { rankTrackingSupport } from "@/modules/tracking/rank-support";
import { buildError } from "@/utils/errors";

/** Virtual clock: sleeping advances time instantly and records every wait. */
function fakeTime() {
	let now = 1_000_000;
	const waits: number[] = [];
	return {
		now: () => now,
		sleep: async (ms: number) => {
			waits.push(ms);
			now += ms;
		},
		waits,
	};
}

function storeError(status: number, retryAfter: string | null = null): unknown {
	try {
		buildError("storeApiError", {
			info: `iTunes search HTTP ${status}`,
			retryAfter,
			status,
		});
	} catch (err) {
		return err;
	}
	return null;
}

describe("StoreThrottle", () => {
	it("spaces consecutive lookups by the store's gap", async () => {
		const time = fakeTime();
		const throttle = new StoreThrottle(3_500, time.now, time.sleep);

		await throttle.acquire();
		await throttle.acquire();
		await throttle.acquire();

		// First slot is immediate, then one gap per call.
		expect(time.waits).toEqual([3_500, 3_500]);
	});

	it("is shared: concurrent callers queue behind each other", async () => {
		let now = 0;
		const waits: number[] = [];
		// Sleeper that does NOT advance time, so both callers see the same now.
		const throttle = new StoreThrottle(
			1_500,
			() => now,
			async (ms) => {
				waits.push(ms);
			},
		);

		await Promise.all([
			throttle.acquire(),
			throttle.acquire(),
			throttle.acquire(),
		]);
		expect(waits.sort((a, b) => a - b)).toEqual([1_500, 3_000]);
		now = 10_000;
		await throttle.acquire();
		expect(waits.length).toBe(2);
	});

	it("penalize pushes every queued caller back", async () => {
		const time = fakeTime();
		const throttle = new StoreThrottle(1_000, time.now, time.sleep);
		await throttle.acquire();
		throttle.penalize(20_000);
		await throttle.acquire();
		expect(time.waits).toEqual([20_000]);
	});

	it("throttled() halves the rate, capped at the max slowdown", () => {
		const time = fakeTime();
		const throttle = new StoreThrottle(1_000, time.now, time.sleep);
		throttle.throttled(0);
		expect(throttle.currentSpacingMs).toBe(2_000);
		for (let i = 0; i < 10; i++) throttle.throttled(0);
		expect(throttle.currentSpacingMs).toBe(1_000 * RANK_LOOKUP_MAX_SLOWDOWN);
	});

	it("speeds back up one step per success streak, never past base", () => {
		const time = fakeTime();
		const throttle = new StoreThrottle(1_000, time.now, time.sleep);
		throttle.throttled(0);
		throttle.throttled(0);
		expect(throttle.currentSpacingMs).toBe(4_000);

		for (let i = 0; i < RANK_LOOKUP_RECOVERY_STREAK - 1; i++) {
			throttle.recordSuccess();
		}
		expect(throttle.currentSpacingMs).toBe(4_000);
		throttle.recordSuccess();
		expect(throttle.currentSpacingMs).toBe(2_000);

		for (let i = 0; i < RANK_LOOKUP_RECOVERY_STREAK * 3; i++) {
			throttle.recordSuccess();
		}
		expect(throttle.currentSpacingMs).toBe(1_000);
	});

	it("a throttle answer resets the recovery streak", () => {
		const time = fakeTime();
		const throttle = new StoreThrottle(1_000, time.now, time.sleep);
		throttle.throttled(0);
		for (let i = 0; i < RANK_LOOKUP_RECOVERY_STREAK - 1; i++) {
			throttle.recordSuccess();
		}
		throttle.throttled(0);
		throttle.recordSuccess();
		expect(throttle.currentSpacingMs).toBe(4_000);
	});

	it("uses the documented per-store spacing", () => {
		expect(RANK_LOOKUP_SPACING_MS.appstore).toBe(3_500);
		expect(RANK_LOOKUP_SPACING_MS.playstore).toBe(1_500);
	});
});

describe("lookupRank", () => {
	it("returns the position on success", async () => {
		const time = fakeTime();
		const rt = configureRankLookup({
			fetchPosition: async () => 4,
			now: time.now,
			sleep: time.sleep,
		});
		const outcome = await lookupRank("appstore", "party game", "1", "us", rt);
		expect(outcome).toEqual({ attempts: 1, ok: true, position: 4 });
		configureRankLookup();
	});

	it("treats 'answered, not in results' as ok with a null position", async () => {
		const rt = configureRankLookup({
			fetchPosition: async () => null,
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
		});
		const outcome = await lookupRank("playstore", "trivia", "a.b", "pl", rt);
		expect(outcome).toEqual({ attempts: 1, ok: true, position: null });
		configureRankLookup();
	});

	it("pauses the store and halves its rate on a 403, then succeeds", async () => {
		const time = fakeTime();
		let calls = 0;
		const rt = configureRankLookup({
			fetchPosition: async () => {
				calls++;
				if (calls < 3) throw storeError(403);
				return 12;
			},
			now: time.now,
			sleep: time.sleep,
		});

		const outcome = await lookupRank("appstore", "quiz", "1", "de", rt);
		expect(outcome).toEqual({ attempts: 3, ok: true, position: 12 });
		expect(time.waits).toEqual([
			RANK_LOOKUP_THROTTLE_PAUSE_MS,
			RANK_LOOKUP_THROTTLE_PAUSE_MS,
		]);
		expect(rt.throttles.appstore.currentSpacingMs).toBe(
			RANK_LOOKUP_SPACING_MS.appstore * 4,
		);
		// The other store keeps its own pace.
		expect(rt.throttles.playstore.currentSpacingMs).toBe(
			RANK_LOOKUP_SPACING_MS.playstore,
		);
		configureRankLookup();
	});

	it("backs off exponentially on 5xx without slowing the store down", async () => {
		const time = fakeTime();
		let calls = 0;
		const rt = configureRankLookup({
			fetchPosition: async () => {
				calls++;
				if (calls < 3) throw storeError(503);
				return 5;
			},
			now: time.now,
			sleep: time.sleep,
		});
		await lookupRank("appstore", "quiz", "1", "de", rt);
		expect(time.waits).toEqual([rankBackoffMs(1), rankBackoffMs(2)]);
		expect(rt.throttles.appstore.currentSpacingMs).toBe(
			RANK_LOOKUP_SPACING_MS.appstore,
		);
		configureRankLookup();
	});

	it("honours Retry-After from the store", async () => {
		const time = fakeTime();
		let calls = 0;
		const rt = configureRankLookup({
			fetchPosition: async () => {
				calls++;
				if (calls === 1) throw storeError(429, "7");
				return 1;
			},
			now: time.now,
			sleep: time.sleep,
		});
		await lookupRank("appstore", "quiz", "1", "us", rt);
		expect(time.waits).toEqual([7_000]);
		configureRankLookup();
	});

	it("gives up after the max attempts and reports a failure, not 'not ranked'", async () => {
		const time = fakeTime();
		let calls = 0;
		const rt = configureRankLookup({
			fetchPosition: async () => {
				calls++;
				throw storeError(503);
			},
			now: time.now,
			sleep: time.sleep,
		});
		const outcome = await lookupRank("appstore", "quiz", "1", "us", rt);
		expect(calls).toBe(RANK_LOOKUP_MAX_ATTEMPTS);
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.status).toBe(503);
			expect(outcome.attempts).toBe(RANK_LOOKUP_MAX_ATTEMPTS);
			expect(outcome.error).toContain("503");
		}
		configureRankLookup();
	});

	it("does not retry a non-retryable status", async () => {
		let calls = 0;
		const rt = configureRankLookup({
			fetchPosition: async () => {
				calls++;
				throw storeError(400);
			},
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
		});
		const outcome = await lookupRank("appstore", "quiz", "1", "us", rt);
		expect(calls).toBe(1);
		expect(outcome.ok).toBe(false);
		configureRankLookup();
	});

	it("retries network errors (no status) and google-play-scraper errors", async () => {
		let calls = 0;
		const rt = configureRankLookup({
			fetchPosition: async () => {
				calls++;
				if (calls === 1) throw new TypeError("fetch failed");
				if (calls === 2)
					throw Object.assign(new Error("Too many"), { status: 429 });
				return 2;
			},
			sleep: async () => {},
			spacingMs: { appstore: 0, playstore: 0 },
		});
		const outcome = await lookupRank("playstore", "quiz", "a.b", "us", rt);
		expect(outcome).toEqual({ attempts: 3, ok: true, position: 2 });
		configureRankLookup();
	});
});

describe("store error helpers", () => {
	it("reads status and Retry-After from a typed store error", () => {
		const detail = describeStoreError(storeError(429, "3"));
		expect(detail.status).toBe(429);
		expect(detail.retryAfterMs).toBe(3_000);
		expect(detail.message).toBe("iTunes search HTTP 429");
	});

	it("classifies retryable statuses", () => {
		expect(isRetryableLookup(403)).toBe(true);
		expect(isRetryableLookup(429)).toBe(true);
		expect(isRetryableLookup(500)).toBe(true);
		expect(isRetryableLookup(null)).toBe(true);
		expect(isRetryableLookup(400)).toBe(false);
		expect(isRetryableLookup(404)).toBe(false);
	});

	it("treats only 403/429 as 'too fast'", () => {
		expect(isThrottleStatus(403)).toBe(true);
		expect(isThrottleStatus(429)).toBe(true);
		expect(isThrottleStatus(503)).toBe(false);
		expect(isThrottleStatus(null)).toBe(false);
	});

	it("caps the backoff", () => {
		expect(rankBackoffMs(20)).toBe(60_000);
	});
});

describe("rankTrackingSupport", () => {
	it("defaults legacy rows to phone and tracks them", () => {
		expect(rankTrackingSupport({ platform: "ios" })).toMatchObject({
			devices: ["phone"],
			supported: true,
			surface: "iphone-search",
		});
	});

	it("refuses a tvOS-only App Store record", () => {
		const support = rankTrackingSupport({ devices: ["tv"], platform: "ios" });
		expect(support.supported).toBe(false);
		expect(support.note).toContain("tvOS");
	});

	it("tracks an iOS record that also ships on Apple TV via iPhone search", () => {
		const support = rankTrackingSupport({
			devices: ["phone", "tv"],
			platform: "ios",
		});
		expect(support.supported).toBe(true);
		expect(support.surface).toBe("iphone-search");
		expect(support.note).toContain("Apple TV");
	});

	it("tracks an Android TV package through Play search", () => {
		const support = rankTrackingSupport({
			devices: ["tv"],
			platform: "android",
		});
		expect(support.supported).toBe(true);
		expect(support.surface).toBe("play-search");
	});
});

// Minimal in-memory sliding-window rate limiter for auth-sensitive endpoints
// (vault unlock, store connect). Per-process only — good enough for a
// single-instance Bun deployment; swap for a shared store when scaling out.
import config from "@/config";

const buckets = new Map<string, number[]>();

/**
 * Rate limiting is disabled under the test runner — every suite shares one
 * test workspace, so real limits would make unrelated suites flaky.
 */
export function rateLimitEnabled(): boolean {
	return config.NODE_ENV !== "test";
}

const MAX_TRACKED_KEYS = 10_000;

/**
 * Record a hit for `key` and report whether it stays within `max` hits per
 * `windowMs`. Returns false when the caller should be rejected (429).
 */
export function checkRateLimit(
	key: string,
	max: number,
	windowMs: number,
): boolean {
	const now = Date.now();
	const cutoff = now - windowMs;
	const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);

	if (hits.length >= max) {
		buckets.set(key, hits);
		return false;
	}

	hits.push(now);

	// Bound memory: drop the oldest buckets once the map grows unreasonable.
	if (!buckets.has(key) && buckets.size >= MAX_TRACKED_KEYS) {
		const oldest = buckets.keys().next().value;
		if (oldest) buckets.delete(oldest);
	}

	buckets.set(key, hits);
	return true;
}

/** Test helper — clears all tracked buckets. */
export function resetRateLimits(): void {
	buckets.clear();
}

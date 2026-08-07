/**
 * Shared retry/backoff primitives for outbound store API calls.
 *
 * Both App Store Connect and Google Play throttle aggressively and return
 * transient 5xx. Retrying without a delay (which is what the ASC client
 * library does out of the box) makes throttling worse, so every retry path
 * in the store providers routes through here.
 */

export const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504] as const;

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 32_000;
const JITTER_RATIO = 0.25;

/** Upper bound on a server-supplied Retry-After, so a hostile value can't stall a request forever. */
const MAX_RETRY_AFTER_MS = 60_000;

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableStatus(status: number): boolean {
	return (RETRYABLE_STATUS_CODES as readonly number[]).includes(status);
}

/**
 * Exponential backoff with full-range jitter, so parallel workers that hit the
 * same rate limit don't retry in lockstep.
 *
 * @param attempt 1-based attempt number that just failed.
 */
export function computeBackoffMs(attempt: number): number {
	const exponential = Math.min(
		BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
		MAX_DELAY_MS,
	);
	const jitter = exponential * JITTER_RATIO * Math.random();
	return Math.round(exponential + jitter);
}

/**
 * Parses a `Retry-After` header (RFC 7231: delay-seconds or HTTP-date).
 * Returns null when the header is absent or unparseable.
 */
export function parseRetryAfterMs(header: string | null): number | null {
	if (!header) return null;

	const seconds = Number(header);
	if (Number.isFinite(seconds)) {
		if (seconds < 0) return null;
		return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS);
	}

	const date = Date.parse(header);
	if (Number.isNaN(date)) return null;

	const delta = date - Date.now();
	if (delta <= 0) return 0;
	return Math.min(delta, MAX_RETRY_AFTER_MS);
}

/**
 * How long to wait after a failed attempt: honour the server's Retry-After
 * when present, otherwise fall back to jittered exponential backoff.
 *
 * Apple's own client (spaceship) ignores Retry-After and backs off blindly;
 * honouring it recovers from throttling sooner.
 */
export function nextDelayMs(
	attempt: number,
	retryAfter: string | null,
): number {
	return parseRetryAfterMs(retryAfter) ?? computeBackoffMs(attempt);
}

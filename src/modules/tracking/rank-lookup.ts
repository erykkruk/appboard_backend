import { ResearchService } from "@/modules/research/research.service";
import type { ResearchStore } from "@/modules/research/research.types";
import { parseRetryAfterMs, sleep } from "@/utils/backoff";

/**
 * Minimum gap between two search lookups against one store, shared by every
 * rank check running in this process. iTunes Search answers 403 after roughly
 * 20 requests a minute per IP; Play web search tolerates more. Same spacing as
 * the standalone Python ASO tool that measured these limits.
 */
export const RANK_LOOKUP_SPACING_MS: Record<ResearchStore, number> = {
	appstore: 3_500,
	playstore: 1_500,
};

/** Attempts per keyword (first try + retries) before it counts as failed. */
export const RANK_LOOKUP_MAX_ATTEMPTS = 4;
/** Backoff after a refused lookup: base * 2^(attempt-1), capped. */
export const RANK_LOOKUP_BACKOFF_BASE_MS = 10_000;
export const RANK_LOOKUP_BACKOFF_MAX_MS = 60_000;
/** iTunes signals throttling with 403, so it is retryable here (unlike ASC). */
export const RANK_LOOKUP_RETRYABLE_STATUSES: readonly number[] = [
	403, 429, 500, 502, 503, 504,
];
/** Statuses that mean "you are too fast" rather than "the store is down". */
export const RANK_LOOKUP_THROTTLE_STATUSES: readonly number[] = [403, 429];
/** Pause for the whole store after a throttle answer without Retry-After. */
export const RANK_LOOKUP_THROTTLE_PAUSE_MS = 5 * 60_000;
/** A throttled store never slows below base spacing times this. */
export const RANK_LOOKUP_MAX_SLOWDOWN = 4;
/** Consecutive successes before a slowed store speeds back up one step. */
export const RANK_LOOKUP_RECOVERY_STREAK = 20;

export type Sleeper = (ms: number) => Promise<void>;
export type Clock = () => number;

/**
 * Hands out lookup slots per store. Callers queue behind each other even when
 * they belong to different runs, so two apps checked at once cannot double the
 * request rate against the same store IP. The spacing adapts: a throttle
 * answer halves the rate (up to RANK_LOOKUP_MAX_SLOWDOWN), and every
 * RANK_LOOKUP_RECOVERY_STREAK successes undo one halving, never going faster
 * than the base spacing measured as safe.
 */
export class StoreThrottle {
	private nextSlotAt = 0;
	private gapMs: number;
	private okStreak = 0;

	constructor(
		private readonly spacingMs: number,
		private readonly now: Clock,
		private readonly wait: Sleeper,
	) {
		this.gapMs = spacingMs;
	}

	get currentSpacingMs(): number {
		return this.gapMs;
	}

	async acquire(): Promise<void> {
		const now = this.now();
		const slot = Math.max(now, this.nextSlotAt);
		this.nextSlotAt = slot + this.gapMs;
		if (slot > now) await this.wait(slot - now);
	}

	/** Push every queued caller back after the store refused a request. */
	penalize(ms: number): void {
		this.nextSlotAt = Math.max(this.nextSlotAt, this.now() + ms);
	}

	/** The store said "too fast": halve the rate and pause the whole store. */
	throttled(pauseMs: number): void {
		this.okStreak = 0;
		this.gapMs = Math.min(
			this.gapMs * 2,
			this.spacingMs * RANK_LOOKUP_MAX_SLOWDOWN,
		);
		this.penalize(pauseMs);
	}

	recordSuccess(): void {
		if (this.gapMs <= this.spacingMs) return;
		this.okStreak++;
		if (this.okStreak < RANK_LOOKUP_RECOVERY_STREAK) return;
		this.okStreak = 0;
		this.gapMs = Math.max(this.spacingMs, this.gapMs / 2);
	}
}

export type RankLookupOutcome =
	| { attempts: number; ok: true; position: number | null }
	| { attempts: number; error: string; ok: false; status: number | null };

export type PositionFetcher = (
	store: ResearchStore,
	keyword: string,
	externalId: string,
	country: string,
) => Promise<number | null>;

export interface RankLookupRuntime {
	fetchPosition: PositionFetcher;
	now: Clock;
	sleep: Sleeper;
	throttles: Record<ResearchStore, StoreThrottle>;
}

function buildRuntime(
	overrides: {
		fetchPosition?: PositionFetcher;
		now?: Clock;
		sleep?: Sleeper;
		spacingMs?: Partial<Record<ResearchStore, number>>;
	} = {},
): RankLookupRuntime {
	const now = overrides.now ?? Date.now;
	const wait = overrides.sleep ?? sleep;
	const spacing = { ...RANK_LOOKUP_SPACING_MS, ...overrides.spacingMs };
	return {
		// Resolved at call time so tests can spy on ResearchService.positionFor.
		fetchPosition:
			overrides.fetchPosition ??
			((store, keyword, id, country) =>
				ResearchService.positionFor(store, keyword, id, country)),
		now,
		sleep: wait,
		throttles: {
			appstore: new StoreThrottle(spacing.appstore, now, wait),
			playstore: new StoreThrottle(spacing.playstore, now, wait),
		},
	};
}

let runtime = buildRuntime();

/**
 * Replace the process-wide throttles (tests: zero spacing and an instant
 * sleeper). Returns the runtime now in use.
 */
export function configureRankLookup(
	overrides: Parameters<typeof buildRuntime>[0] = {},
): RankLookupRuntime {
	runtime = buildRuntime(overrides);
	return runtime;
}

export function getRankLookupRuntime(): RankLookupRuntime {
	return runtime;
}

interface StoreErrorDetail {
	message: string;
	retryAfterMs: number | null;
	status: number | null;
}

/**
 * Read status + Retry-After from whatever the store client threw: our typed
 * `buildError` (Elysia status response carrying `data.status`) or the
 * google-play-scraper error (`err.status`).
 */
export function describeStoreError(err: unknown): StoreErrorDetail {
	const detail: StoreErrorDetail = {
		message: "Store lookup failed",
		retryAfterMs: null,
		status: null,
	};
	if (!err || typeof err !== "object") {
		if (err !== undefined) detail.message = String(err);
		return detail;
	}
	const record = err as {
		message?: unknown;
		response?: {
			data?: { info?: unknown; retryAfter?: unknown; status?: unknown };
		};
		status?: unknown;
	};
	const data = record.response?.data;
	const status = data?.status ?? record.status;
	if (typeof status === "number" && Number.isFinite(status)) {
		detail.status = status;
	}
	if (typeof data?.retryAfter === "string") {
		detail.retryAfterMs = parseRetryAfterMs(data.retryAfter);
	}
	const message = data?.info ?? record.message;
	if (typeof message === "string" && message) detail.message = message;
	return detail;
}

/** Network/parse errors carry no status and are worth another try. */
export function isRetryableLookup(status: number | null): boolean {
	return status === null || RANK_LOOKUP_RETRYABLE_STATUSES.includes(status);
}

export function isThrottleStatus(status: number | null): boolean {
	return status !== null && RANK_LOOKUP_THROTTLE_STATUSES.includes(status);
}

export function rankBackoffMs(attempt: number): number {
	return Math.min(
		RANK_LOOKUP_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1),
		RANK_LOOKUP_BACKOFF_MAX_MS,
	);
}

type ThrottledOutcome<T> =
	| { attempts: number; ok: true; value: T }
	| { attempts: number; detail: StoreErrorDetail; error: unknown; ok: false };

/**
 * One store request through the process-wide throttle: wait for a slot,
 * retry refused or failed requests with backoff, slow the whole store down on
 * 403/429. Shared by rank lookups and the nightly keyword-score refresh, so
 * the two never add up to a burst against the same store IP.
 */
async function callThrottled<T>(
	store: ResearchStore,
	call: () => Promise<T>,
	rt: RankLookupRuntime,
): Promise<ThrottledOutcome<T>> {
	const throttle = rt.throttles[store];
	let lastError: unknown = null;
	let last: StoreErrorDetail = {
		message: "Store lookup failed",
		retryAfterMs: null,
		status: null,
	};
	for (let attempt = 1; attempt <= RANK_LOOKUP_MAX_ATTEMPTS; attempt++) {
		await throttle.acquire();
		try {
			const value = await call();
			throttle.recordSuccess();
			return { attempts: attempt, ok: true, value };
		} catch (err) {
			lastError = err;
			last = describeStoreError(err);
			if (
				!isRetryableLookup(last.status) ||
				attempt === RANK_LOOKUP_MAX_ATTEMPTS
			) {
				return { attempts: attempt, detail: last, error: err, ok: false };
			}
			// The whole store backs off, not only this run: the limit is per IP.
			if (isThrottleStatus(last.status)) {
				throttle.throttled(last.retryAfterMs ?? RANK_LOOKUP_THROTTLE_PAUSE_MS);
			} else {
				throttle.penalize(last.retryAfterMs ?? rankBackoffMs(attempt));
			}
		}
	}
	return {
		attempts: RANK_LOOKUP_MAX_ATTEMPTS,
		detail: last,
		error: lastError,
		ok: false,
	};
}

/**
 * Run any request against a store under the shared throttle and retry
 * policy. Resolves with the call's value; rethrows the last error once every
 * attempt failed, so callers keep their own error handling.
 */
export async function throttledStoreCall<T>(
	store: ResearchStore,
	call: () => Promise<T>,
	rt: RankLookupRuntime = runtime,
): Promise<T> {
	const outcome = await callThrottled(store, call, rt);
	if (outcome.ok) return outcome.value;
	throw outcome.error;
}

/**
 * One keyword's position, throttled per store and retried with backoff.
 * `ok: true` with `position: null` means the store answered and we are not in
 * the scanned results; `ok: false` means we could not measure at all - the
 * caller must not record that as "not ranked".
 */
export async function lookupRank(
	store: ResearchStore,
	keyword: string,
	externalId: string,
	country: string,
	rt: RankLookupRuntime = runtime,
): Promise<RankLookupOutcome> {
	const outcome = await callThrottled(
		store,
		() => rt.fetchPosition(store, keyword, externalId, country),
		rt,
	);
	if (outcome.ok) {
		return { attempts: outcome.attempts, ok: true, position: outcome.value };
	}
	return {
		attempts: outcome.attempts,
		error: outcome.detail.message,
		ok: false,
		status: outcome.detail.status,
	};
}

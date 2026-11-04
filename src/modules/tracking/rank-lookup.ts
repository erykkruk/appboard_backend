import config from "@/config";
import { ResearchService } from "@/modules/research/research.service";
import type { ResearchStore } from "@/modules/research/research.types";
import { parseRetryAfterMs, sleep } from "@/utils/backoff";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import {
	NO_STORE_VERSIONS,
	publicStoreVersions,
	type StoreVersionSource,
} from "./store-versions";

const log = createLogger("rank-lookup");

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
/** Absolute floor on the pace: never slower than one lookup per this gap. */
export const RANK_LOOKUP_MAX_SPACING_MS = 20_000;
/** Consecutive successes before a slowed store speeds back up one step. */
export const RANK_LOOKUP_RECOVERY_STREAK = 10;
/**
 * Additive recovery: each streak takes this share of the base spacing off the
 * gap (AIMD - the rate halves on a throttle, comes back in small steps).
 */
export const RANK_LOOKUP_RECOVERY_STEP_RATIO = 0.5;
/**
 * A store that throttles us this many times inside the window is blocked for
 * batch work: the run stops cleanly and the rest is measured at the next slot,
 * instead of crawling at one lookup per pause for hours.
 */
export const STORE_THROTTLE_MAX_EVENTS = 3;
export const STORE_THROTTLE_WINDOW_MS = 30 * 60_000;
/** Keywords in a row whose lookup failed (after retries) before a run stops. */
export const STORE_BREAKER_MAX_CONSECUTIVE_FAILURES = 8;
/** A run stops when the store has answered nothing for this long. */
export const STORE_BREAKER_MAX_STALL_MS = 30 * 60_000;
/**
 * Hard cap on one run: 1,000 keywords at four times the base App Store
 * spacing still fit, and a blocked store cannot hold the app's lock and the
 * shared throttle for days.
 */
export const STORE_BREAKER_MAX_RUN_MS = 4 * 60 * 60_000;
/** Error code on a run (or refresh) the breaker stopped. */
export const STORE_THROTTLED_CODE = "STORE_THROTTLED";

export type Sleeper = (ms: number) => Promise<void>;
export type Clock = () => number;

/**
 * Hands out lookup slots per store. Callers queue behind each other even when
 * they belong to different runs, so two apps checked at once cannot double the
 * request rate against the same store IP. The spacing adapts AIMD style: a
 * throttle answer doubles the gap (up to RANK_LOOKUP_MAX_SLOWDOWN times the
 * base and never past RANK_LOOKUP_MAX_SPACING_MS), and every
 * RANK_LOOKUP_RECOVERY_STREAK successes take a small fixed step back toward
 * the base spacing measured as safe. Throttle answers are remembered for
 * STORE_THROTTLE_WINDOW_MS so batch callers can stop on a store that keeps
 * refusing us.
 */
export class StoreThrottle {
	private nextSlotAt = 0;
	private gapMs: number;
	private okStreak = 0;
	private throttleEvents: number[] = [];

	constructor(
		private readonly spacingMs: number,
		private readonly now: Clock,
		private readonly wait: Sleeper,
		readonly store: ResearchStore | null = null,
	) {
		this.gapMs = spacingMs;
	}

	get currentSpacingMs(): number {
		return this.gapMs;
	}

	/** When the next caller would get its slot (now if the store is free). */
	nextSlotTime(): number {
		return Math.max(this.now(), this.nextSlotAt);
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
	throttled(pauseMs: number, status: number | null = null): void {
		this.okStreak = 0;
		this.gapMs = Math.min(
			this.gapMs * 2,
			this.spacingMs * RANK_LOOKUP_MAX_SLOWDOWN,
			Math.max(this.spacingMs, RANK_LOOKUP_MAX_SPACING_MS),
		);
		this.penalize(pauseMs);
		const now = this.now();
		this.throttleEvents = [...this.recentThrottles(now), now];
		log.warn(
			{
				pauseMs,
				spacingMs: this.gapMs,
				status,
				store: this.store,
				throttlesInWindow: this.throttleEvents.length,
			},
			"Store throttled rank lookups - pausing and slowing down",
		);
	}

	recordSuccess(): void {
		if (this.gapMs <= this.spacingMs) return;
		this.okStreak++;
		if (this.okStreak < RANK_LOOKUP_RECOVERY_STREAK) return;
		this.okStreak = 0;
		this.gapMs = Math.max(
			this.spacingMs,
			this.gapMs - this.spacingMs * RANK_LOOKUP_RECOVERY_STEP_RATIO,
		);
	}

	/**
	 * Why batch work must stop on this store right now, or null. Set once the
	 * store throttled us STORE_THROTTLE_MAX_EVENTS times inside the window; it
	 * clears by itself as the oldest answer leaves the window.
	 */
	blockedReason(): string | null {
		const recent = this.recentThrottles(this.now());
		if (recent.length < STORE_THROTTLE_MAX_EVENTS) return null;
		return `Store throttled: ${recent.length} throttle answers in ${Math.round(STORE_THROTTLE_WINDOW_MS / 60_000)} min, the rest is measured at the next scheduled check`;
	}

	private recentThrottles(now: number): number[] {
		return this.throttleEvents.filter(
			(at) => now - at < STORE_THROTTLE_WINDOW_MS,
		);
	}
}

/**
 * One batch run per store at a time, process-wide. Two Play apps of a
 * workspace then run one after the other: the first finishes at full pace
 * instead of both crawling half-way, and the waiting run's breaker does not
 * tick while it waits.
 */
export class StoreRunQueue {
	private tails: Record<ResearchStore, Promise<void>> = {
		appstore: Promise.resolve(),
		playstore: Promise.resolve(),
	};
	private waiting: Record<ResearchStore, number> = {
		appstore: 0,
		playstore: 0,
	};

	/** Runs queued or running on the store (for logs and tests). */
	depth(store: ResearchStore): number {
		return this.waiting[store];
	}

	async run<T>(store: ResearchStore, work: () => Promise<T>): Promise<T> {
		const previous = this.tails[store];
		let release: () => void = () => {};
		const mine = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.tails[store] = previous.then(() => mine);
		this.waiting[store]++;
		try {
			await previous;
			return await work();
		} finally {
			this.waiting[store]--;
			release();
		}
	}
}

export interface StoreBreakerLimits {
	maxConsecutiveFailures: number;
	maxRunMs: number;
	maxStallMs: number;
}

const DEFAULT_BREAKER_LIMITS: StoreBreakerLimits = {
	maxConsecutiveFailures: STORE_BREAKER_MAX_CONSECUTIVE_FAILURES,
	maxRunMs: STORE_BREAKER_MAX_RUN_MS,
	maxStallMs: STORE_BREAKER_MAX_STALL_MS,
};

/**
 * Circuit breaker for one long batch of store requests (a rank check or the
 * nightly score refresh). It trips after too many failed lookups in a row,
 * when the store has answered nothing for too long, or at the run time limit;
 * the caller then stops instead of queueing for hours on a blocked store.
 */
export class StoreBreaker {
	private consecutiveFailures = 0;
	private lastSuccessAt: number;
	private reason: string | null = null;
	private readonly startedAt: number;

	constructor(
		private readonly now: Clock,
		private readonly limits: StoreBreakerLimits = DEFAULT_BREAKER_LIMITS,
	) {
		this.startedAt = now();
		this.lastSuccessAt = this.startedAt;
	}

	/** Why the batch must stop, or null while it may continue. */
	get trippedReason(): string | null {
		return this.reason;
	}

	/** Latest moment a request may still be waiting for its store slot. */
	deadlineAt(): number {
		return Math.min(
			this.startedAt + this.limits.maxRunMs,
			this.lastSuccessAt + this.limits.maxStallMs,
		);
	}

	recordSuccess(): void {
		this.consecutiveFailures = 0;
		this.lastSuccessAt = this.now();
	}

	recordFailure(): void {
		this.consecutiveFailures++;
		if (this.consecutiveFailures >= this.limits.maxConsecutiveFailures) {
			this.trip(
				`Store throttled: ${this.consecutiveFailures} lookups in a row failed`,
			);
		}
	}

	/** The store kept throttling us: stop and leave the rest for the next slot. */
	recordStoreBlocked(reason: string): void {
		this.trip(reason);
	}

	/** A request would have had to wait past `deadlineAt()`. */
	recordDeadline(): void {
		const runEnd = this.startedAt + this.limits.maxRunMs;
		const stallEnd = this.lastSuccessAt + this.limits.maxStallMs;
		this.trip(
			runEnd <= stallEnd
				? `Run time limit reached (${Math.round(this.limits.maxRunMs / 60_000)} min)`
				: `Store throttled: no answer from the store for ${Math.round(this.limits.maxStallMs / 60_000)} min`,
		);
	}

	private trip(reason: string): void {
		this.reason ??= reason;
	}
}

/** Throw the typed error that ends a batch stopped by its breaker. */
export function throwStoreThrottled(reason: string): never {
	buildError("storeUnavailable", { code: STORE_THROTTLED_CODE, info: reason });
}

export type RankLookupOutcome =
	| { attempts: number; ok: true; position: number | null }
	| {
			attempts: number;
			/** Gave up without waiting: the next store slot was past the deadline. */
			deadlineHit: boolean;
			error: string;
			ok: false;
			status: number | null;
			/** Set when the store is blocked for batch work (see StoreThrottle). */
			storeBlocked: string | null;
	  };

export type PositionFetcher = (
	store: ResearchStore,
	keyword: string,
	externalId: string,
	country: string,
) => Promise<number | null>;

export interface RankLookupRuntime {
	fetchPosition: PositionFetcher;
	now: Clock;
	runs: StoreRunQueue;
	sleep: Sleeper;
	throttles: Record<ResearchStore, StoreThrottle>;
	/** Which store version is live, recorded next to every measurement. */
	versions: StoreVersionSource;
}

function buildRuntime(
	overrides: {
		fetchPosition?: PositionFetcher;
		now?: Clock;
		sleep?: Sleeper;
		spacingMs?: Partial<Record<ResearchStore, number>>;
		versions?: StoreVersionSource;
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
		runs: new StoreRunQueue(),
		sleep: wait,
		throttles: {
			appstore: new StoreThrottle(spacing.appstore, now, wait, "appstore"),
			playstore: new StoreThrottle(spacing.playstore, now, wait, "playstore"),
		},
		// Tests never reach a store; they inject `versions` to exercise it.
		versions:
			overrides.versions ??
			(config.NODE_ENV === "test" ? NO_STORE_VERSIONS : publicStoreVersions),
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
		// A store may ask for up to our own pause length; longer asks are cut
		// to it (the breaker ends a run that stays blocked anyway).
		detail.retryAfterMs = parseRetryAfterMs(
			data.retryAfter,
			RANK_LOOKUP_THROTTLE_PAUSE_MS,
		);
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
	| {
			attempts: number;
			deadlineHit: boolean;
			detail: StoreErrorDetail;
			error: unknown;
			ok: false;
			storeBlocked: string | null;
	  };

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
	deadlineAt?: number,
): Promise<ThrottledOutcome<T>> {
	const throttle = rt.throttles[store];
	let lastError: unknown = null;
	let last: StoreErrorDetail = {
		message: "Store lookup failed",
		retryAfterMs: null,
		status: null,
	};
	for (let attempt = 1; attempt <= RANK_LOOKUP_MAX_ATTEMPTS; attempt++) {
		// Batch callers (they pass a deadline) stop on a store that keeps
		// throttling us; interactive calls just wait their turn.
		const blocked = deadlineAt !== undefined ? throttle.blockedReason() : null;
		if (blocked) {
			return {
				attempts: attempt - 1,
				deadlineHit: true,
				detail: { ...last, message: blocked },
				error: lastError,
				ok: false,
				storeBlocked: blocked,
			};
		}
		if (deadlineAt !== undefined && throttle.nextSlotTime() > deadlineAt) {
			return {
				attempts: attempt - 1,
				deadlineHit: true,
				detail: { ...last, message: "Store throttled: lookup not attempted" },
				error: lastError,
				ok: false,
				storeBlocked: null,
			};
		}
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
				return {
					attempts: attempt,
					deadlineHit: false,
					detail: last,
					error: err,
					ok: false,
					storeBlocked: null,
				};
			}
			// The whole store backs off, not only this run: the limit is per IP.
			if (isThrottleStatus(last.status)) {
				throttle.throttled(
					last.retryAfterMs ?? RANK_LOOKUP_THROTTLE_PAUSE_MS,
					last.status,
				);
			} else {
				throttle.penalize(last.retryAfterMs ?? rankBackoffMs(attempt));
			}
		}
	}
	return {
		attempts: RANK_LOOKUP_MAX_ATTEMPTS,
		deadlineHit: false,
		detail: last,
		error: lastError,
		ok: false,
		storeBlocked: null,
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
 * A pacer for a long batch (the nightly score refresh): every call goes
 * through the shared throttle and retry policy and is counted by `breaker`.
 * Once the breaker trips, every further call fails at once with
 * STORE_THROTTLED instead of queueing on a blocked store.
 */
export function breakerPacer(
	store: ResearchStore,
	breaker: StoreBreaker,
	rt: RankLookupRuntime = runtime,
): <T>(call: () => Promise<T>) => Promise<T> {
	return async <T>(call: () => Promise<T>): Promise<T> => {
		const tripped = breaker.trippedReason;
		if (tripped) throwStoreThrottled(tripped);
		const outcome = await callThrottled(store, call, rt, breaker.deadlineAt());
		if (outcome.ok) {
			breaker.recordSuccess();
			return outcome.value;
		}
		if (outcome.storeBlocked) {
			breaker.recordStoreBlocked(outcome.storeBlocked);
			throwStoreThrottled(breaker.trippedReason ?? outcome.storeBlocked);
		}
		if (outcome.deadlineHit) {
			breaker.recordDeadline();
			throwStoreThrottled(breaker.trippedReason ?? outcome.detail.message);
		}
		breaker.recordFailure();
		throw outcome.error;
	};
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
	deadlineAt?: number,
): Promise<RankLookupOutcome> {
	const outcome = await callThrottled(
		store,
		() => rt.fetchPosition(store, keyword, externalId, country),
		rt,
		deadlineAt,
	);
	if (outcome.ok) {
		return { attempts: outcome.attempts, ok: true, position: outcome.value };
	}
	return {
		attempts: outcome.attempts,
		deadlineHit: outcome.deadlineHit,
		error: outcome.detail.message,
		ok: false,
		status: outcome.detail.status,
		storeBlocked: outcome.storeBlocked,
	};
}

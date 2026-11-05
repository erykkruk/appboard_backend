import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { AppsService } from "@/modules/apps/apps.service";
import { HistoryService } from "@/modules/history/history.service";
import { isBrandKeyword } from "@/modules/research/listing-audit";
import type { ResearchStore } from "@/modules/research/research.types";
import { db } from "@/utils/db";
import {
	appAsoProfiles,
	apps,
	appTrackingConfig,
	listingVersions,
	rankSnapshots,
	trackedKeywords,
	user,
	workspaceMembers,
} from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import { AppEventsService, CHART_EVENT_TYPES } from "./app-events.service";
import {
	type ListingVersionApp,
	ListingVersionService,
} from "./listing-versions.service";
import { RankCheckJobs } from "./rank-check.jobs";
import {
	getRankLookupRuntime,
	lookupRank,
	type RankLookupRuntime,
	StoreBreaker,
	type StoreBreakerLimits,
	throwStoreDeferred,
	throwStoreThrottled,
} from "./rank-lookup";
import { rankTrackingSupport } from "./rank-support";
import {
	AUTO_RESEARCH_FREQUENCIES,
	type AutoResearchFrequency,
	type BulkAddMarketResult,
	type BulkStarMarketResult,
	DEFAULT_TRACKING_COUNTRY,
	type LatestPosition,
	MAX_KEYWORDS_PER_COUNTRY,
	type RankCheckKind,
	type RankCheckResult,
	type RankLookupFailure,
	type TrackingSummaryStats,
} from "./tracking.types";

const log = createLogger("tracking");

/**
 * Keywords never measured first, then the ones measured longest ago. A run the
 * store cuts short then leaves a different tail every time, so over a few
 * slots every keyword gets measured instead of the same alphabetical end
 * staying "not measured" forever.
 */
export function orderLeastRecentlyMeasured<
	T extends { country: string; keyword: string },
>(keywords: T[], lastMeasuredAt: Map<string, number>): T[] {
	const at = (k: T) =>
		lastMeasuredAt.get(measurementKey(k.country, k.keyword)) ??
		Number.NEGATIVE_INFINITY;
	return keywords
		.map((k, index) => ({ index, k }))
		.sort((a, b) => at(a.k) - at(b.k) || a.index - b.index)
		.map(({ k }) => k);
}

/**
 * Brand keywords (the app's own name) and starred keywords go first, each
 * group least recently measured first. A run the store cuts short then still
 * measures the phrases the owner watches, instead of leaving "buzzin" out on
 * the night it happened to sit in the tail.
 */
export function orderForRankCheck<
	T extends { country: string; keyword: string; starred?: boolean | null },
>(keywords: T[], lastMeasuredAt: Map<string, number>, appName: string): T[] {
	const ordered = orderLeastRecentlyMeasured(keywords, lastMeasuredAt);
	const first = (k: T) => !!k.starred || isBrandKeyword(k.keyword, appName);
	return [...ordered.filter(first), ...ordered.filter((k) => !first(k))];
}

/**
 * Scheduled runs of a store with a catch-up slot skip keywords measured in
 * the last `freshMs`, so the second slot of the night only asks the store for
 * what the first one missed. Null = measure everything (App Store slots are
 * 12 h apart, manual checks always measure everything).
 */
export const RANK_CHECK_FRESH_MS_BY_STORE: Record<
	ResearchStore,
	number | null
> = {
	appstore: null,
	playstore: 6 * 60 * 60_000,
};

export function skipRecentlyMeasured<
	T extends { country: string; keyword: string },
>(
	keywords: T[],
	lastMeasuredAt: Map<string, number>,
	now: number,
	freshMs: number,
): T[] {
	return keywords.filter((k) => {
		const at = lastMeasuredAt.get(measurementKey(k.country, k.keyword));
		return at === undefined || now - at >= freshMs;
	});
}

export function measurementKey(country: string, keyword: string): string {
	return `${country.toLowerCase()}\u0000${keyword.toLowerCase()}`;
}

/**
 * A first check that measured nothing (store refused, server restarted) is
 * retried from the dashboard summary, but at most this often.
 */
export const SUMMARY_RETRY_COOLDOWN_MS = 30 * 60_000;
/** Latest + previous measurement is all any overview compares. */
export const MEASUREMENTS_PER_KEYWORD = 2;

/** One of the newest measurements of a tracked keyword. */
export interface KeywordMeasurement {
	country: string;
	createdAt: Date;
	keyword: string;
	platform: string;
	position: number | null;
}

/** Progress shape a running check reports (also what the run row stores). */
export interface RankCheckProgress {
	checked: number;
	failed: number;
	failures: RankLookupFailure[];
	measured: number;
	ranked: number;
	total: number;
}

export interface RankCheckOptions {
	/** Called after every lookup; the job runner flushes it to the run row. */
	onProgress?: (progress: RankCheckProgress) => Promise<void> | void;
	runtime?: RankLookupRuntime;
	/** Tests: tighter breaker limits than the production defaults. */
	breakerLimits?: StoreBreakerLimits;
}

function normalizeKeywords(keywords: string[]): string[] {
	return [
		...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)),
	];
}

export interface ConfigPatch {
	autoResearchEnabled?: boolean;
	autoResearchFrequency?: AutoResearchFrequency;
	emailRankDigest?: boolean;
	notifyEmail?: string | null;
	rankTrackingEnabled?: boolean;
}

export class TrackingService {
	/** Fetch the app's tracking config, creating a default (all OFF) if absent. */
	static async getConfig(appId: string, workspaceId: string) {
		const [existing] = await db
			.select()
			.from(appTrackingConfig)
			.where(eq(appTrackingConfig.appId, appId))
			.limit(1);
		if (existing) return existing;

		const [created] = await db
			.insert(appTrackingConfig)
			.values({ appId, workspaceId })
			.onConflictDoNothing()
			.returning();
		if (created) return created;

		// Lost a race — read the row the concurrent insert created.
		const [row] = await db
			.select()
			.from(appTrackingConfig)
			.where(eq(appTrackingConfig.appId, appId))
			.limit(1);
		return row;
	}

	static async updateConfig(
		appId: string,
		workspaceId: string,
		patch: ConfigPatch,
	) {
		if (
			patch.autoResearchFrequency &&
			!AUTO_RESEARCH_FREQUENCIES.includes(patch.autoResearchFrequency)
		) {
			buildError("badRequest", { info: "Invalid auto-research frequency" });
		}
		// Ensure a row exists first.
		await TrackingService.getConfig(appId, workspaceId);
		const [updated] = await db
			.update(appTrackingConfig)
			.set(patch)
			.where(eq(appTrackingConfig.appId, appId))
			.returning();
		return updated;
	}

	static async getKeywords(appId: string) {
		return db
			.select()
			.from(trackedKeywords)
			.where(eq(trackedKeywords.appId, appId))
			.orderBy(asc(trackedKeywords.country), asc(trackedKeywords.keyword));
	}

	/** Newest snapshot time per (country, keyword) of an app. */
	static async lastMeasuredAt(appId: string): Promise<Map<string, number>> {
		const rows = await db
			.select({
				at: sql<Date>`max(${rankSnapshots.createdAt})`,
				country: rankSnapshots.country,
				keyword: rankSnapshots.keyword,
			})
			.from(rankSnapshots)
			.where(eq(rankSnapshots.appId, appId))
			.groupBy(rankSnapshots.country, rankSnapshots.keyword);
		return new Map(
			rows.map((r) => [
				measurementKey(r.country, r.keyword),
				new Date(r.at).getTime(),
			]),
		);
	}

	/**
	 * Add keywords for a country, capped at MAX_KEYWORDS_PER_COUNTRY. Existing
	 * duplicates are ignored. Rejects with 422 when the cap would be exceeded.
	 */
	static async addKeywords(appId: string, country: string, keywords: string[]) {
		// Normalize country + keywords to lowercase so the unique constraint and
		// rank-snapshot grouping stay consistent regardless of caller casing.
		const cc = country.toLowerCase();
		const cleaned = normalizeKeywords(keywords);
		if (!cleaned.length) {
			buildError("badRequest", { info: "No valid keywords provided" });
		}

		const existing = await db
			.select({ keyword: trackedKeywords.keyword })
			.from(trackedKeywords)
			.where(
				and(eq(trackedKeywords.appId, appId), eq(trackedKeywords.country, cc)),
			);
		const existingSet = new Set(existing.map((r) => r.keyword));
		const toAdd = cleaned.filter((k) => !existingSet.has(k));

		if (existingSet.size + toAdd.length > MAX_KEYWORDS_PER_COUNTRY) {
			buildError("validationFailed", {
				info: `Max ${MAX_KEYWORDS_PER_COUNTRY} keywords per language (${cc} has ${existingSet.size})`,
			});
		}

		if (toAdd.length) {
			await db
				.insert(trackedKeywords)
				.values(toAdd.map((keyword) => ({ appId, country: cc, keyword })))
				.onConflictDoNothing();
		}

		return TrackingService.getKeywords(appId);
	}

	/**
	 * Add keywords for many markets in one call (hundreds of phrases across
	 * dozens of countries). Unlike `addKeywords` it never rejects the whole
	 * request: each market reports what was added, what was already tracked and
	 * what did not fit under MAX_KEYWORDS_PER_COUNTRY.
	 */
	static async addKeywordsBulk(
		appId: string,
		items: Array<{ country: string; keywords: string[] }>,
	): Promise<{
		keywords: Awaited<ReturnType<typeof TrackingService.getKeywords>>;
		results: BulkAddMarketResult[];
		totals: { added: number; rejected: number; skipped: number };
	}> {
		// Merge repeated countries so the cap is applied once per market.
		const requested = new Map<string, string[]>();
		for (const item of items) {
			const cc = item.country.trim().toLowerCase();
			requested.set(cc, [...(requested.get(cc) ?? []), ...item.keywords]);
		}

		const existingRows = await db
			.select({
				country: trackedKeywords.country,
				keyword: trackedKeywords.keyword,
			})
			.from(trackedKeywords)
			.where(eq(trackedKeywords.appId, appId));
		const existingByCountry = new Map<string, Set<string>>();
		for (const row of existingRows) {
			const set = existingByCountry.get(row.country) ?? new Set<string>();
			set.add(row.keyword);
			existingByCountry.set(row.country, set);
		}

		const results: BulkAddMarketResult[] = [];
		const rows: Array<{ appId: string; country: string; keyword: string }> = [];
		for (const [country, raw] of [...requested.entries()].sort((a, b) =>
			a[0].localeCompare(b[0]),
		)) {
			const existing = existingByCountry.get(country) ?? new Set<string>();
			// Duplicates inside the request collapse silently, like addKeywords.
			const unique = normalizeKeywords(raw);
			const fresh = unique.filter((k) => !existing.has(k));
			const room = Math.max(0, MAX_KEYWORDS_PER_COUNTRY - existing.size);
			const added = fresh.slice(0, room);
			results.push({
				added,
				country,
				rejected: fresh.slice(room),
				skipped: unique.filter((k) => existing.has(k)),
			});
			for (const keyword of added) rows.push({ appId, country, keyword });
		}

		if (rows.length) {
			await db.insert(trackedKeywords).values(rows).onConflictDoNothing();
		}
		log.info(
			{ added: rows.length, appId, markets: results.length },
			"Bulk-added tracked keywords",
		);

		const totals = results.reduce(
			(acc, r) => ({
				added: acc.added + r.added.length,
				rejected: acc.rejected + r.rejected.length,
				skipped: acc.skipped + r.skipped.length,
			}),
			{ added: 0, rejected: 0, skipped: 0 },
		);
		return {
			keywords: await TrackingService.getKeywords(appId),
			results,
			totals,
		};
	}

	static async removeKeyword(appId: string, keywordId: string) {
		const [deleted] = await db
			.delete(trackedKeywords)
			.where(
				and(
					eq(trackedKeywords.id, keywordId),
					eq(trackedKeywords.appId, appId),
				),
			)
			.returning({ id: trackedKeywords.id });
		if (!deleted) buildError("notFound", { info: "Keyword not found" });
		return { id: deleted.id, success: true };
	}

	/** Mark (or unmark) one tracked keyword as one of the team's own targets. */
	static async setStarred(appId: string, keywordId: string, starred: boolean) {
		const [updated] = await db
			.update(trackedKeywords)
			.set({ starred })
			.where(
				and(
					eq(trackedKeywords.id, keywordId),
					eq(trackedKeywords.appId, appId),
				),
			)
			.returning();
		if (!updated) buildError("notFound", { info: "Keyword not found" });
		return updated;
	}

	/**
	 * Star or unstar many tracked keywords by market and phrase in one call
	 * (seeding the team's targets across dozens of markets). Phrases that are
	 * not tracked are reported back, never added: starring does not track.
	 */
	static async setStarredBulk(
		appId: string,
		items: Array<{ country: string; keywords: string[] }>,
		starred: boolean,
	): Promise<{
		results: BulkStarMarketResult[];
		totals: { notTracked: number; updated: number };
	}> {
		const requested = new Map<string, string[]>();
		for (const item of items) {
			const cc = item.country.trim().toLowerCase();
			requested.set(cc, [...(requested.get(cc) ?? []), ...item.keywords]);
		}

		const results: BulkStarMarketResult[] = [];
		for (const [country, raw] of [...requested.entries()].sort((a, b) =>
			a[0].localeCompare(b[0]),
		)) {
			const keywords = normalizeKeywords(raw);
			const rows = keywords.length
				? await db
						.update(trackedKeywords)
						.set({ starred })
						.where(
							and(
								eq(trackedKeywords.appId, appId),
								eq(trackedKeywords.country, country),
								inArray(trackedKeywords.keyword, keywords),
							),
						)
						.returning({ keyword: trackedKeywords.keyword })
				: [];
			const updated = new Set(rows.map((r) => r.keyword));
			results.push({
				country,
				notTracked: keywords.filter((k) => !updated.has(k)),
				updated: keywords.filter((k) => updated.has(k)),
			});
		}
		log.info(
			{ appId, markets: results.length, starred },
			"Bulk-starred tracked keywords",
		);

		const totals = results.reduce(
			(acc, r) => ({
				notTracked: acc.notTracked + r.notTracked.length,
				updated: acc.updated + r.updated.length,
			}),
			{ notTracked: 0, updated: 0 },
		);
		return { results, totals };
	}

	/**
	 * Import keywords from the app's ASO profile ("Information" tab) into the
	 * tracked set for the default country. Silently fills up to the per-country
	 * cap instead of rejecting, so the dashboard can call it on every load.
	 * Enables rank tracking when it imports anything, so the scheduler picks
	 * the app up automatically.
	 */
	static async syncKeywordsFromProfile(
		appId: string,
		workspaceId: string,
	): Promise<number> {
		const [profile] = await db
			.select({
				longTail: appAsoProfiles.longTailKeywords,
				mustInclude: appAsoProfiles.mustIncludeKeywords,
			})
			.from(appAsoProfiles)
			.where(eq(appAsoProfiles.appId, appId))
			.limit(1);
		if (!profile) return 0;

		const fromProfile = [
			...new Set(
				[...(profile.mustInclude ?? []), ...(profile.longTail ?? [])]
					.map((k) => k.trim().toLowerCase())
					.filter(Boolean),
			),
		];
		if (!fromProfile.length) return 0;

		const cc = DEFAULT_TRACKING_COUNTRY;
		const existing = await db
			.select({ keyword: trackedKeywords.keyword })
			.from(trackedKeywords)
			.where(
				and(eq(trackedKeywords.appId, appId), eq(trackedKeywords.country, cc)),
			);
		const existingSet = new Set(existing.map((r) => r.keyword));
		const room = MAX_KEYWORDS_PER_COUNTRY - existingSet.size;
		const toAdd = fromProfile
			.filter((k) => !existingSet.has(k))
			.slice(0, Math.max(0, room));
		if (!toAdd.length) return 0;

		await db
			.insert(trackedKeywords)
			.values(toAdd.map((keyword) => ({ appId, country: cc, keyword })))
			.onConflictDoNothing();
		await TrackingService.getConfig(appId, workspaceId);
		await db
			.update(appTrackingConfig)
			.set({ rankTrackingEnabled: true })
			.where(eq(appTrackingConfig.appId, appId));

		log.info({ appId, imported: toAdd.length }, "Synced keywords from profile");
		return toAdd.length;
	}

	/**
	 * Dashboard summary: syncs ASO-profile keywords into tracking, runs a first
	 * rank check when there are keywords but no measurements yet, and returns
	 * aggregate stats alongside the latest positions.
	 */
	static async getSummary(appId: string, workspaceId: string) {
		await TrackingService.syncKeywordsFromProfile(appId, workspaceId);

		const keywords = await TrackingService.getKeywords(appId);
		const positions = await TrackingService.getLatestPositions(appId);
		// The first check runs in the background: throttled store lookups for a
		// few hundred keywords take minutes, far longer than a request may block.
		// `rankCheck` tells the caller a measurement is on its way.
		let rankCheck = await RankCheckJobs.latest(appId, workspaceId);
		if (
			keywords.length &&
			!positions.length &&
			TrackingService.shouldStartFirstCheck(rankCheck, new Date())
		) {
			const started = await RankCheckJobs.startIfSupported(
				appId,
				workspaceId,
				"summary",
			);
			rankCheck = started?.run ?? null;
		}
		const config = await TrackingService.getConfig(appId, workspaceId);

		const ranked = positions.filter((p) => p.position !== null);
		const stats: TrackingSummaryStats = {
			avgPosition: ranked.length
				? Math.round(
						(ranked.reduce((sum, p) => sum + (p.position as number), 0) /
							ranked.length) *
							10,
					) / 10
				: null,
			bestPosition: ranked.length
				? Math.min(...ranked.map((p) => p.position as number))
				: null,
			declinedCount: positions.filter((p) => (p.delta ?? 0) < 0).length,
			improvedCount: positions.filter((p) => (p.delta ?? 0) > 0).length,
			lastCheckedAt: config?.lastRankCheckAt ?? null,
			rankedKeywords: ranked.length,
			top10Count: ranked.filter((p) => (p.position as number) <= 10).length,
			trackedKeywords: keywords.length,
		};

		return { config, positions, rankCheck, stats };
	}

	/**
	 * Whether the summary should (re)start the first check: none ran yet, or
	 * the latest one ended without measuring anything and the cooldown passed.
	 */
	static shouldStartFirstCheck(
		latest: {
			finishedAt: Date | null;
			measured: number;
			startedAt: Date;
			status: string;
		} | null,
		now: Date,
	): boolean {
		if (!latest) return true;
		if (latest.status === "running" || latest.measured > 0) return false;
		const endedAt = new Date(latest.finishedAt ?? latest.startedAt).getTime();
		return now.getTime() - endedAt >= SUMMARY_RETRY_COOLDOWN_MS;
	}

	/**
	 * Measure the current search position of every tracked keyword and persist a
	 * snapshot per (keyword, country). Positions come from the same store clients
	 * the research tool uses. Updates `lastRankCheckAt`.
	 */
	static async runRankCheck(
		appId: string,
		workspaceId: string,
		kind: RankCheckKind = "manual",
		options: RankCheckOptions = {},
	): Promise<RankCheckResult> {
		const app = await AppsService.findOne(workspaceId, appId);
		const support = rankTrackingSupport(app);
		if (!support.supported) {
			buildError("validationFailed", {
				code: "RANK_TRACKING_UNSUPPORTED",
				info: support.note ?? "Rank tracking is not available for this app",
			});
		}
		const store = support.store;
		const runtime = options.runtime ?? getRankLookupRuntime();
		if (runtime.runs.depth(store) > 0) {
			log.info(
				{ appId, queuedAhead: runtime.runs.depth(store), store },
				"Rank check waiting for another run on the same store",
			);
		}
		// One run per store at a time: the breaker and the keyword list are
		// built once it is our turn, so waiting does not count against the run.
		return runtime.runs.run(store, () => {
			// The run ahead of us got the store blocked: every lookup would be
			// refused, so end as deferred before the first store request.
			const deferred = runtime.throttles[store].deferredReason();
			if (deferred) {
				log.warn({ appId, kind, store }, "Rank check deferred: store blocked");
				throwStoreDeferred(deferred);
			}
			return TrackingService.measureKeywords(
				{ ...app, id: appId },
				appId,
				store,
				kind,
				runtime,
				options,
			);
		});
	}

	private static async measureKeywords(
		app: ListingVersionApp & { name?: string | null },
		appId: string,
		store: ResearchStore,
		kind: RankCheckKind,
		runtime: RankLookupRuntime,
		options: RankCheckOptions,
	): Promise<RankCheckResult> {
		const lastMeasured = await TrackingService.lastMeasuredAt(appId);
		const freshMs =
			kind === "scheduled" ? RANK_CHECK_FRESH_MS_BY_STORE[store] : null;
		const tracked = await TrackingService.getKeywords(appId);
		const due =
			freshMs === null
				? tracked
				: skipRecentlyMeasured(tracked, lastMeasured, runtime.now(), freshMs);
		const keywords = orderForRankCheck(due, lastMeasured, app.name ?? "");
		if (due.length < tracked.length) {
			log.info(
				{ appId, due: due.length, fresh: tracked.length - due.length, store },
				"Rank check skips keywords measured in this night's earlier slot",
			);
		}

		const progress: RankCheckProgress = {
			checked: 0,
			failed: 0,
			failures: [],
			measured: 0,
			ranked: 0,
			total: keywords.length,
		};
		// Which store version and listing text each measurement was taken
		// against. Attributing the snapshots from before this existed comes
		// first, so it can tell old snapshots from this run's.
		// A catch-up slot with nothing left to measure asks the store nothing.
		const countries = keywords.map((k) => k.country);
		if (keywords.length > 0) {
			await ListingVersionService.backfill(
				app,
				store,
				countries[0] ?? DEFAULT_TRACKING_COUNTRY,
				runtime,
			);
		}
		const listingVersionByCountry =
			keywords.length > 0
				? await ListingVersionService.recordForRun(
						app,
						store,
						countries,
						runtime,
					)
				: new Map<string, string | null>();
		const breaker = new StoreBreaker(runtime.now, options.breakerLimits);
		// Scheduled slots share Play searches between apps; a manual check
		// always asks the store, so "Check now" is a fresh measurement.
		const reuseSearch = kind === "scheduled";
		let reused = 0;
		const stopIfTripped = () => {
			const reason = breaker.trippedReason;
			if (!reason) return;
			// The rest stays "not measured": no snapshot, previous position kept.
			log.warn(
				{ appId, checked: progress.checked, reason, total: keywords.length },
				"Rank check stopped by the store breaker",
			);
			throwStoreThrottled(reason);
		};
		for (const { country, keyword } of keywords) {
			stopIfTripped();
			const outcome = await lookupRank(
				store,
				keyword,
				app.externalId,
				country,
				runtime,
				breaker.deadlineAt(),
				{ reuseSearch },
			);
			if (!outcome.ok && outcome.storeBlocked) {
				breaker.recordStoreBlocked(outcome.storeBlocked);
				stopIfTripped();
			}
			if (!outcome.ok && outcome.deadlineHit) {
				breaker.recordDeadline();
				stopIfTripped();
			}
			progress.checked++;
			if (outcome.ok) {
				await db.insert(rankSnapshots).values({
					appId,
					country,
					keyword,
					listingVersionId:
						listingVersionByCountry.get(country.toLowerCase()) ?? null,
					platform: store,
					position: outcome.position,
				});
				progress.measured++;
				if (outcome.position !== null) progress.ranked++;
				// A reused search is not a store answer: it must not hide a
				// failure streak or a stalled store from the breaker.
				if (outcome.reused) reused++;
				else breaker.recordSuccess();
			} else {
				// No snapshot: a NULL row would read as "fell out of the results".
				progress.failed++;
				progress.failures.push({
					attempts: outcome.attempts,
					country,
					error: outcome.error,
					keyword,
					status: outcome.status,
				});
				log.warn(
					{ appId, country, keyword, status: outcome.status },
					"Rank lookup failed - no snapshot recorded",
				);
				breaker.recordFailure();
			}
			await options.onProgress?.(progress);
		}

		await db
			.update(appTrackingConfig)
			.set({ lastRankCheckAt: new Date() })
			.where(eq(appTrackingConfig.appId, appId));

		log.info(
			{
				appId,
				failed: progress.failed,
				kind,
				ranked: progress.ranked,
				reused,
				snapshots: progress.measured,
			},
			"Rank check complete",
		);
		return {
			checked: keywords.length,
			failed: progress.failed,
			ranked: progress.ranked,
			snapshots: progress.measured,
		};
	}

	/**
	 * Time-series of rank snapshots plus listing-change annotations, for the
	 * per-app rank chart. Snapshots are ordered oldest→newest.
	 */
	static async getHistory(
		appId: string,
		filters?: { country?: string; keyword?: string },
	) {
		const conditions = [eq(rankSnapshots.appId, appId)];
		if (filters?.country) {
			conditions.push(eq(rankSnapshots.country, filters.country));
		}
		if (filters?.keyword) {
			conditions.push(eq(rankSnapshots.keyword, filters.keyword));
		}
		// The store version live at each measurement (NULL = unknown).
		const snapshots = await db
			.select({
				...getTableColumns(rankSnapshots),
				version: listingVersions.versionString,
			})
			.from(rankSnapshots)
			.leftJoin(
				listingVersions,
				eq(rankSnapshots.listingVersionId, listingVersions.id),
			)
			.where(and(...conditions))
			.orderBy(asc(rankSnapshots.createdAt));

		// Everything that could have moved these ranks, overlaid on the chart:
		// listing field edits from history, plus version and publish events.
		// Without the second source a new release leaves no mark at all, and a
		// jump in the graph looks like it came from nowhere.
		const history = await HistoryService.getHistory(appId);
		const events = await AppEventsService.list(appId);
		const annotations = [
			...history.map((h) => ({
				date: h.publishedAt ?? h.createdAt,
				field: h.field,
				label: `${h.field} changed`,
				language: h.language,
				newValue: h.newValue,
				oldValue: h.oldValue,
				type: "listing_field" as const,
			})),
			// Housekeeping events (reminder emails) are recorded for their own
			// cooldown, not because they moved a ranking - keep them off the chart.
			...events
				.filter((e) => CHART_EVENT_TYPES.has(e.type))
				.map((e) => ({
					date: e.occurredAt,
					field: e.type,
					label: e.label,
					language: "",
					newValue: null,
					oldValue: null,
					type: e.type,
				})),
		].sort(
			(a, b) =>
				new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime(),
		);

		return { annotations, snapshots };
	}

	/**
	 * The newest MEASUREMENTS_PER_KEYWORD snapshots of every tracked keyword,
	 * newest first per keyword. One index probe per keyword (LATERAL ... LIMIT),
	 * so the cost follows the tracked keywords, not months of snapshots. Shared
	 * by the summary, board, digest and per-market overview so they agree.
	 */
	static async getLatestMeasurements(
		appId: string,
	): Promise<KeywordMeasurement[]> {
		const latest = db
			.select({
				createdAt: rankSnapshots.createdAt,
				platform: rankSnapshots.platform,
				position: rankSnapshots.position,
			})
			.from(rankSnapshots)
			.where(
				and(
					eq(rankSnapshots.appId, trackedKeywords.appId),
					eq(rankSnapshots.country, trackedKeywords.country),
					eq(rankSnapshots.keyword, trackedKeywords.keyword),
				),
			)
			.orderBy(desc(rankSnapshots.createdAt))
			.limit(MEASUREMENTS_PER_KEYWORD)
			.as("latest");
		return db
			.select({
				country: trackedKeywords.country,
				createdAt: latest.createdAt,
				keyword: trackedKeywords.keyword,
				platform: latest.platform,
				position: latest.position,
			})
			.from(trackedKeywords)
			.innerJoinLateral(latest, sql`true`)
			.where(eq(trackedKeywords.appId, appId))
			.orderBy(
				asc(trackedKeywords.country),
				asc(trackedKeywords.keyword),
				desc(latest.createdAt),
			);
	}

	/** Latest position per tracked (keyword, country) with the change since the previous check. */
	static async getLatestPositions(appId: string): Promise<LatestPosition[]> {
		const rows = await TrackingService.getLatestMeasurements(appId);

		const grouped = new Map<string, typeof rows>();
		for (const row of rows) {
			const key = `${row.country}|${row.keyword}`;
			const list = grouped.get(key);
			if (list) list.push(row);
			else grouped.set(key, [row]);
		}

		const out: LatestPosition[] = [];
		for (const list of grouped.values()) {
			// `rows` is newest-first, so [0] is latest, [1] the prior measurement.
			const latest = list[0];
			const prev = list[1];
			const position = latest.position;
			const previousPosition = prev?.position ?? null;
			const delta =
				position !== null && previousPosition !== null
					? previousPosition - position
					: null;
			out.push({
				capturedAt: latest.createdAt,
				country: latest.country,
				delta,
				keyword: latest.keyword,
				platform: latest.platform,
				position,
				previousPosition,
			});
		}
		out.sort(
			(a, b) =>
				a.country.localeCompare(b.country) ||
				a.keyword.localeCompare(b.keyword),
		);
		return out;
	}

	/** Resolve where a report should be emailed (config override → owner email). */
	static async resolveNotifyEmail(
		workspaceId: string,
		override?: string | null,
	): Promise<string | null> {
		if (override) return override;
		const [owner] = await db
			.select({ email: user.email })
			.from(workspaceMembers)
			.innerJoin(user, eq(workspaceMembers.userId, user.id))
			.where(
				and(
					eq(workspaceMembers.workspaceId, workspaceId),
					eq(workspaceMembers.role, "owner"),
				),
			)
			.limit(1);
		return owner?.email ?? null;
	}

	// ── Scheduler helpers (cross-workspace) ──────────────────────────

	/** Rank-tracking configs plus the app platform (it picks the slots). */
	static async listRankTrackingConfigs() {
		return db
			.select({
				...getTableColumns(appTrackingConfig),
				platform: apps.platform,
			})
			.from(appTrackingConfig)
			.innerJoin(apps, eq(apps.id, appTrackingConfig.appId))
			.where(eq(appTrackingConfig.rankTrackingEnabled, true));
	}

	static async listAutoResearchConfigs() {
		return db
			.select()
			.from(appTrackingConfig)
			.where(eq(appTrackingConfig.autoResearchEnabled, true));
	}

	static async markAutoResearchRun(appId: string) {
		await db
			.update(appTrackingConfig)
			.set({ lastAutoResearchAt: new Date() })
			.where(eq(appTrackingConfig.appId, appId));
	}

	static async markScoreRefreshRun(appId: string) {
		await db
			.update(appTrackingConfig)
			.set({ lastScoreRefreshAt: new Date() })
			.where(eq(appTrackingConfig.appId, appId));
	}
}

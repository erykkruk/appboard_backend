import { and, desc, eq, inArray } from "drizzle-orm";
import {
	cacheCutoff,
	KEYWORD_SCORE_CACHE_TTL_DAYS,
	KeywordScoreCacheService,
} from "@/modules/research/keyword-score-cache.service";
import { KeywordScoresHistoryService } from "@/modules/research/keyword-scores-history.service";
import {
	ResearchService,
	scoreFromSearch,
} from "@/modules/research/research.service";
import { db } from "@/utils/db";
import {
	appTrackingConfig,
	keywordScoreRefreshRuns,
	rankSnapshots,
	trackedKeywords,
} from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";
import {
	breakerPacer,
	getRankLookupRuntime,
	StoreBreaker,
	type StoreBreakerLimits,
} from "./rank-lookup";

const log = createLogger("score-refresh");

/**
 * A cache entry is refreshed once it is older than this: one day before the
 * read TTL, so the nightly slice renews tracked keywords before an
 * interactive read would have to ask the store again.
 */
export const SCORE_REFRESH_AFTER_DAYS = KEYWORD_SCORE_CACHE_TTL_DAYS - 1;
/** Every tracked pair is refreshed once over this many nightly slices. */
export const SCORE_REFRESH_SPREAD_DAYS = 7;
/** Small installs finish their whole backlog in one night. */
export const SCORE_REFRESH_MIN_SLICE = 50;

/** One tracked (keyword, country) pair and who tracks it. */
export interface TrackedScorePair {
	country: string;
	keyword: string;
	/** workspaceId -> apps of that workspace tracking the pair. */
	workspaces: Map<string, string[]>;
}

export type ScoreRefreshStatus = "running" | "completed" | "failed";

export interface ScoreRefreshSummary {
	day: string;
	due: number;
	failed: number;
	pairs: number;
	refreshed: number;
	resumed: boolean;
	snapshots: number;
	status: ScoreRefreshStatus;
	target: number;
}

function pairKey(keyword: string, country: string): string {
	return `${country}:${keyword}`;
}

/**
 * Every tracked (keyword, country) pair of every rank-tracking app, across
 * ALL workspaces, deduplicated: three apps tracking the same phrase in the
 * same storefront need one App Store search, not three.
 */
export async function collectTrackedPairs(): Promise<TrackedScorePair[]> {
	const rows = await db
		.select({
			appId: trackedKeywords.appId,
			country: trackedKeywords.country,
			keyword: trackedKeywords.keyword,
			workspaceId: appTrackingConfig.workspaceId,
		})
		.from(trackedKeywords)
		.innerJoin(
			appTrackingConfig,
			eq(appTrackingConfig.appId, trackedKeywords.appId),
		)
		.where(eq(appTrackingConfig.rankTrackingEnabled, true));
	const pairs = new Map<string, TrackedScorePair>();
	for (const row of rows) {
		const country = row.country.toLowerCase();
		const keyword = row.keyword.trim().toLowerCase();
		if (!keyword) continue;
		const key = pairKey(keyword, country);
		const pair = pairs.get(key) ?? {
			country,
			keyword,
			workspaces: new Map<string, string[]>(),
		};
		const apps = pair.workspaces.get(row.workspaceId) ?? [];
		if (!apps.includes(row.appId)) apps.push(row.appId);
		pair.workspaces.set(row.workspaceId, apps);
		pairs.set(key, pair);
	}
	return [...pairs.values()];
}

/**
 * How many stale pairs one night refreshes: a seventh of everything tracked
 * (so each pair comes round about once a week and a night stays short), at
 * least SCORE_REFRESH_MIN_SLICE, never more than are due.
 */
export function refreshSliceSize(pairCount: number, dueCount: number): number {
	const share = Math.ceil(pairCount / SCORE_REFRESH_SPREAD_DAYS);
	return Math.min(dueCount, Math.max(SCORE_REFRESH_MIN_SLICE, share));
}

/**
 * The pairs whose cache entry is missing or older than
 * SCORE_REFRESH_AFTER_DAYS, never-scored first, then oldest first.
 */
export function stalePairs<T extends { country: string; keyword: string }>(
	pairs: T[],
	scoredAt: Map<string, Date>,
	now: Date,
): T[] {
	const cutoff = cacheCutoff(now, SCORE_REFRESH_AFTER_DAYS).getTime();
	const age = (p: T) =>
		scoredAt.get(pairKey(p.keyword, p.country))?.getTime() ??
		Number.NEGATIVE_INFINITY;
	return pairs
		.filter((p) => age(p) < cutoff)
		.sort(
			(a, b) =>
				age(a) - age(b) ||
				a.country.localeCompare(b.country) ||
				a.keyword.localeCompare(b.keyword),
		);
}

async function cacheAges(
	pairs: TrackedScorePair[],
): Promise<Map<string, Date>> {
	const byCountry = new Map<string, string[]>();
	for (const p of pairs) {
		byCountry.set(p.country, [...(byCountry.get(p.country) ?? []), p.keyword]);
	}
	const ages = new Map<string, Date>();
	for (const [country, keywords] of byCountry) {
		const scored = await KeywordScoreCacheService.scoredAtMany(
			keywords,
			country,
		);
		for (const [keyword, scoredAt] of scored) {
			ages.set(pairKey(keyword, country), scoredAt);
		}
	}
	return ages;
}

/**
 * The newest App Store position of each keyword among these apps, from the
 * rank checks (rank_snapshots). The own rank is app-specific, so the nightly
 * refresh never caches it and never asks the store for it: the 00:00 rank
 * check already measured it. Best position wins when a workspace has
 * several apps on the phrase; null = measured and not ranked, or never
 * measured.
 */
async function latestAppStoreRanks(
	appIds: string[],
	country: string,
	keywords: string[],
): Promise<Map<string, number | null>> {
	const ranks = new Map<string, number | null>();
	if (!appIds.length || !keywords.length) return ranks;
	const rows = await db
		.selectDistinctOn([rankSnapshots.appId, rankSnapshots.keyword], {
			keyword: rankSnapshots.keyword,
			position: rankSnapshots.position,
		})
		.from(rankSnapshots)
		.where(
			and(
				inArray(rankSnapshots.appId, appIds),
				eq(rankSnapshots.country, country),
				eq(rankSnapshots.platform, "appstore"),
				inArray(rankSnapshots.keyword, keywords),
			),
		)
		.orderBy(
			rankSnapshots.appId,
			rankSnapshots.keyword,
			desc(rankSnapshots.createdAt),
		);
	for (const row of rows) {
		const prev = ranks.get(row.keyword) ?? null;
		if (row.position === null) {
			if (!ranks.has(row.keyword)) ranks.set(row.keyword, null);
			continue;
		}
		ranks.set(
			row.keyword,
			prev === null ? row.position : Math.min(prev, row.position),
		);
	}
	return ranks;
}

/**
 * Give every workspace a history snapshot of each tracked pair's newest
 * cached measurement it does not have yet (score trend, board, summary read
 * those). No store traffic: the score is recomputed from the cached search
 * with the workspace's own Apple Ads source and its apps' latest ranks.
 * Covers pairs refreshed tonight and pairs another workspace (or an
 * interactive score) put in the cache. Returns snapshots written.
 */
export async function fillWorkspaceSnapshots(
	pairs: TrackedScorePair[],
): Promise<number> {
	const byWorkspace = new Map<string, Map<string, Map<string, string[]>>>();
	for (const pair of pairs) {
		for (const [workspaceId, appIds] of pair.workspaces) {
			const countries =
				byWorkspace.get(workspaceId) ??
				new Map<string, Map<string, string[]>>();
			const keywords = countries.get(pair.country) ?? new Map();
			keywords.set(pair.keyword, appIds);
			countries.set(pair.country, keywords);
			byWorkspace.set(workspaceId, countries);
		}
	}
	let written = 0;
	for (const [workspaceId, countries] of byWorkspace) {
		for (const [country, keywordApps] of countries) {
			const keywords = [...keywordApps.keys()];
			const cache = await KeywordScoreCacheService.getMany(keywords, country);
			if (!cache.size) continue;
			const latest = await KeywordScoresHistoryService.latestDays(
				workspaceId,
				country,
				keywords,
			);
			const need = keywords.filter((keyword) => {
				const entry = cache.get(keyword);
				if (!entry) return false;
				const day = latest.get(keyword);
				return !day || day < entry.scoredAt.toISOString().slice(0, 10);
			});
			if (!need.length) continue;
			const appIds = [
				...new Set(need.flatMap((k) => keywordApps.get(k) ?? [])),
			];
			const [apple, ranks] = await Promise.all([
				ResearchService.appleContext(workspaceId, country, need),
				latestAppStoreRanks(appIds, country, need),
			]);
			const scores = need.flatMap((keyword) => {
				const entry = cache.get(keyword);
				if (!entry) return [];
				return [
					scoreFromSearch(entry, country, apple, {
						appRank: ranks.get(keyword) ?? null,
						cached: true,
					}),
				];
			});
			await KeywordScoresHistoryService.upsertScores(workspaceId, scores);
			written += scores.length;
		}
	}
	return written;
}

async function openRun(
	day: string,
	plan: { due: number; pairs: number; target: number },
): Promise<{
	resumed: boolean;
	run: typeof keywordScoreRefreshRuns.$inferSelect;
} | null> {
	const [created] = await db
		.insert(keywordScoreRefreshRuns)
		.values({ day, ...plan })
		.onConflictDoNothing()
		.returning();
	if (created) return { resumed: false, run: created };
	const [existing] = await db
		.select()
		.from(keywordScoreRefreshRuns)
		.where(eq(keywordScoreRefreshRuns.day, day))
		.limit(1);
	if (!existing || existing.status !== "running") return null;
	// A `running` row nobody in this process owns was cut off by a restart:
	// carry on with what is left of its slice.
	const [resumed] = await db
		.update(keywordScoreRefreshRuns)
		.set({ due: plan.due, pairs: plan.pairs })
		.where(eq(keywordScoreRefreshRuns.id, existing.id))
		.returning();
	return { resumed: true, run: resumed ?? existing };
}

/** Today's run row, if any (the scheduler's "already done today?" check). */
export async function getRefreshRun(day: string) {
	const [row] = await db
		.select()
		.from(keywordScoreRefreshRuns)
		.where(eq(keywordScoreRefreshRuns.day, day))
		.limit(1);
	return row ?? null;
}

/**
 * The nightly keyword-score refresh, global across workspaces: dedupe every
 * tracked pair, take today's slice of the stale ones (missing or older than
 * SCORE_REFRESH_AFTER_DAYS), ask the App Store once per pair through the
 * shared throttle and circuit breaker, and store the answers in the global
 * cache. Progress is written to `keyword_score_refresh_runs` after every
 * pair, so a run a restart cut off resumes where it stopped (the refreshed
 * pairs are no longer stale; the counters cap the rest of the slice).
 * Finally every workspace gets snapshots of the measurements it lacks.
 * Returns null when today's run already finished.
 */
export async function runScoreCacheRefresh(
	day: string,
	options: {
		breakerLimits?: StoreBreakerLimits;
		now?: Date;
		/** Test seam: the tracked pairs to work on (default: all of them). */
		pairs?: TrackedScorePair[];
	} = {},
): Promise<ScoreRefreshSummary | null> {
	const now = options.now ?? new Date();
	const pairs = options.pairs ?? (await collectTrackedPairs());
	const due = stalePairs(pairs, await cacheAges(pairs), now);
	const opened = await openRun(day, {
		due: due.length,
		pairs: pairs.length,
		target: refreshSliceSize(pairs.length, due.length),
	});
	if (!opened) return null;
	const { resumed, run } = opened;

	let refreshed = run.refreshed;
	let failed = run.failed;
	const remaining = Math.max(0, run.target - refreshed - failed);
	const rt = getRankLookupRuntime();
	const breaker = new StoreBreaker(rt.now, options.breakerLimits);
	const pace = breakerPacer("appstore", breaker, rt);
	let status: ScoreRefreshStatus = "completed";
	let error: string | null = null;

	for (const pair of due.slice(0, remaining)) {
		if (breaker.trippedReason) {
			status = "failed";
			error = `Store throttled: ${breaker.trippedReason}`;
			log.warn(
				{ day, reason: breaker.trippedReason },
				"Score refresh stopped by the store breaker",
			);
			break;
		}
		try {
			await ResearchService.fetchKeywordSearch(pair.keyword, pair.country, {
				pace,
			});
			refreshed++;
		} catch (err) {
			failed++;
			log.warn(
				{ country: pair.country, err, keyword: pair.keyword },
				"Score refresh lookup failed",
			);
		}
		await db
			.update(keywordScoreRefreshRuns)
			.set({ failed, refreshed })
			.where(eq(keywordScoreRefreshRuns.id, run.id));
	}
	if (status === "completed" && breaker.trippedReason) {
		status = "failed";
		error = `Store throttled: ${breaker.trippedReason}`;
	}

	let snapshots = 0;
	try {
		snapshots = await fillWorkspaceSnapshots(pairs);
	} catch (err) {
		log.error({ day, err }, "Score snapshot fill failed");
	}

	await db
		.update(keywordScoreRefreshRuns)
		.set({ error, failed, finishedAt: new Date(), refreshed, status })
		.where(eq(keywordScoreRefreshRuns.id, run.id));
	const summary: ScoreRefreshSummary = {
		day,
		due: due.length,
		failed,
		pairs: pairs.length,
		refreshed,
		resumed,
		snapshots,
		status,
		target: run.target,
	};
	log.info(summary, "Keyword score cache refresh finished");
	return summary;
}

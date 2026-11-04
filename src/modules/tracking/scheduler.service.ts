import config from "@/config";
import { AppleAdsService } from "@/modules/apple-ads/apple-ads.service";
import { AppsService } from "@/modules/apps/apps.service";
import { AuditService } from "@/modules/audit/audit.service";
import {
	AUTO_RESEARCH_EVENT,
	DailySummaryService,
} from "@/modules/daily-summary/daily-summary.service";
import { PublicReportsService } from "@/modules/public-reports/public-reports.service";
import { FreeToolQuotaService } from "@/modules/public-reports/quota.service";
import { KeywordScoreCacheService } from "@/modules/research/keyword-score-cache.service";
import { KeywordScoresHistoryService } from "@/modules/research/keyword-scores-history.service";
import { ResearchRunsService } from "@/modules/research/research.runs.service";
import {
	ResearchService,
	type StorePacer,
} from "@/modules/research/research.service";
import {
	platformToStore,
	type ResearchRunReport,
	type ResearchStore,
} from "@/modules/research/research.types";
import type { KeywordScore } from "@/modules/research/scoring-types";
import { createLogger } from "@/utils/logger";
import { AppEventsService } from "./app-events.service";
import { DraftReminderService } from "./draft-reminder.service";
import { RankCheckJobs } from "./rank-check.jobs";
import {
	breakerPacer,
	getRankLookupRuntime,
	StoreBreaker,
	type StoreBreakerLimits,
} from "./rank-lookup";
import { ReportService } from "./report.service";
import { reportMail } from "./report-mail";
import {
	runScoreCacheRefresh,
	type ScoreRefreshSummary,
} from "./score-refresh.service";
import { KeywordSuggestionsService } from "./suggestions.service";
import { TrackingService } from "./tracking.service";
import {
	AUTO_RESEARCH_HOUR,
	type AutoResearchFrequency,
	DEFAULT_SCHEDULER_TZ,
	IDEA_RESCORE_DAYS,
	IDEAS_SCORED_PER_MARKET,
	RESEARCH_ROTATION_DAYS,
	rankCheckHoursFor,
	type TrackingSchedule,
} from "./tracking.types";

const log = createLogger("scheduler");

const TICK_MS = 60_000;
const HOUR_MS = 60 * 60 * 1000;
/**
 * A slot is skipped when the app's last rank check finished less than this
 * long ago: guards a slot re-firing (restart, overlapping tick) and skips a
 * slot right after a manual check. With two App Store slots 12 h apart, 6 h
 * is half the interval. Google Play has one slot a day, so the gap is short:
 * with 6 h a manual Play check in the evening skipped the 00:00 slot and the
 * next scheduled measurement came 48 h after the previous one.
 */
export const RANK_CHECK_MIN_GAP_MS_BY_STORE: Record<ResearchStore, number> = {
	appstore: 6 * HOUR_MS,
	playstore: 2 * HOUR_MS,
};
// Keyword-score cache refresh starts daily at 01:00 local (offset from the
// midnight rank check so the two batches never hammer iTunes at the same
// time). A run a restart cut off resumes on the next tick of the same day.
const SCORE_REFRESH_HOUR = 1;
// Apple Ads dataset sync runs daily at 02:00; it no-ops for countries whose
// newest completed week is already active, so it only downloads on Mondays.
const APPLE_SYNC_HOUR = 2;
/** Morning, local time: a nudge about a draft nobody published. */
const DRAFT_REMINDER_HOUR = 9;
/** Weekly listing audit sweep: Monday, a quiet hour, all stored audits. */
const AUDIT_REFRESH_WEEKDAY = 1;
const AUDIT_REFRESH_HOUR = 3;
const FREQUENCY_DAYS: Record<AutoResearchFrequency, number> = {
	daily: 1,
	monthly: 30,
	weekly: 7,
};
// Fire a day/week/month interval slightly early to absorb tick jitter.
const FREQUENCY_GRACE_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead "next run" is searched (a monthly run plus slack). */
const NEXT_RUN_SEARCH_DAYS = 40;
/** Best scored ideas kept on the auto-research event for the daily summary. */
const TOP_IDEAS_RECORDED = 3;

interface RankSchedulable {
	lastRankCheckAt: Date | null;
	/** Picks the slots: see RANK_CHECK_HOURS_BY_STORE. */
	store: ResearchStore;
}
interface ResearchSchedulable {
	autoResearchFrequency: string;
	lastAutoResearchAt: Date | null;
}

/** Local hour/minute in the scheduler timezone (deterministic, testable). */
export function localHourMinute(
	now: Date,
	tz: string,
): { hour: number; minute: number } {
	const parts = new Intl.DateTimeFormat("en-US", {
		hour: "2-digit",
		hour12: false,
		minute: "2-digit",
		timeZone: tz,
	}).formatToParts(now);
	const get = (type: string) =>
		Number(parts.find((p) => p.type === type)?.value ?? "0");
	// Intl renders midnight as "24" in some locales — normalize to 0.
	const hour = get("hour") % 24;
	return { hour, minute: get("minute") };
}

/** Local day of week (0 = Sunday) in the scheduler timezone. */
export function localWeekday(now: Date, tz: string): number {
	const name = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		weekday: "short",
	}).format(now);
	return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** Stored audits are re-measured once a week, never on page views. */
export function isAuditRefreshDue(now: Date, tz: string): boolean {
	const { hour, minute } = localHourMinute(now, tz);
	return (
		localWeekday(now, tz) === AUDIT_REFRESH_WEEKDAY &&
		hour === AUDIT_REFRESH_HOUR &&
		minute === 0
	);
}

export function isRankCheckDue(
	cfg: RankSchedulable,
	now: Date,
	tz: string,
): boolean {
	const { hour, minute } = localHourMinute(now, tz);
	if (minute !== 0 || !rankCheckHoursFor(cfg.store).includes(hour)) {
		return false;
	}
	if (!cfg.lastRankCheckAt) return true;
	return (
		now.getTime() - new Date(cfg.lastRankCheckAt).getTime() >=
		RANK_CHECK_MIN_GAP_MS_BY_STORE[cfg.store]
	);
}

/**
 * The day's score refresh may run from 01:00 local until midnight; whether
 * it already ran (or is still running) is decided by its run row, so a run
 * a deploy restart killed at 03:00 picks up again at 03:01.
 */
export function isScoreRefreshDue(now: Date, tz: string): boolean {
	return localHourMinute(now, tz).hour >= SCORE_REFRESH_HOUR;
}

/** Local calendar date (YYYY-MM-DD) in the scheduler timezone. */
export function localDayKey(now: Date, tz: string): string {
	return new Date(localDayNumber(now, tz) * DAY_MS).toISOString().slice(0, 10);
}

export function isAutoResearchDue(
	cfg: ResearchSchedulable,
	now: Date,
	tz: string,
): boolean {
	const { hour, minute } = localHourMinute(now, tz);
	if (minute !== 0 || hour !== AUTO_RESEARCH_HOUR) return false;
	if (!cfg.lastAutoResearchAt) return true;
	const days =
		FREQUENCY_DAYS[cfg.autoResearchFrequency as AutoResearchFrequency] ??
		FREQUENCY_DAYS.weekly;
	const intervalMs = days * 24 * 60 * 60 * 1000 - FREQUENCY_GRACE_MS;
	return (
		now.getTime() - new Date(cfg.lastAutoResearchAt).getTime() >= intervalMs
	);
}

/** Days since 1970-01-01 of the local calendar date in the timezone. */
export function localDayNumber(now: Date, tz: string): number {
	const parts = new Intl.DateTimeFormat("en-CA", {
		day: "2-digit",
		month: "2-digit",
		timeZone: tz,
		year: "numeric",
	}).formatToParts(now);
	const get = (type: string) =>
		Number(parts.find((p) => p.type === type)?.value ?? "0");
	return Math.floor(
		Date.UTC(get("year"), get("month") - 1, get("day")) / DAY_MS,
	);
}

/**
 * The markets one scheduled research run scores new keyword ideas in. Weekly
 * and monthly runs cover every tracked market. A daily run covers one slice,
 * so each market is still covered once every RESEARCH_ROTATION_DAYS without
 * asking the App Store about every market every morning.
 */
export function marketsForResearchRun(
	countries: string[],
	frequency: string,
	dayNumber: number,
): string[] {
	const sorted = [...new Set(countries.map((c) => c.toLowerCase()))].sort();
	if (frequency !== "daily") return sorted;
	const slice = dayNumber % RESEARCH_ROTATION_DAYS;
	return sorted.filter((_, i) => i % RESEARCH_ROTATION_DAYS === slice);
}

/**
 * Where the full research run (store page, reviews, AI) goes: the app's home
 * storefront when it is tracked; otherwise the market where most tracked
 * keywords rank, then the one with most keywords. With every market at the
 * keyword cap, "most keywords" alone picked the first market alphabetically.
 */
export function primaryResearchMarket(
	tracked: Array<{ country: string }>,
	homeCountry: string | null | undefined,
	rankedByCountry: ReadonlyMap<string, number> = new Map(),
): string {
	const counts = new Map<string, number>();
	for (const k of tracked) {
		const c = k.country.toLowerCase();
		counts.set(c, (counts.get(c) ?? 0) + 1);
	}
	const home = homeCountry?.toLowerCase();
	if (home && counts.has(home)) return home;
	let best = "us";
	let bestRanked = -1;
	let bestCount = 0;
	for (const [country, count] of [...counts.entries()].sort()) {
		const ranked = rankedByCountry.get(country) ?? 0;
		if (ranked > bestRanked || (ranked === bestRanked && count > bestCount)) {
			best = country;
			bestRanked = ranked;
			bestCount = count;
		}
	}
	return best;
}

/** Tracked keywords per market whose newest measurement is a ranking. */
export function rankedKeywordsByCountry(
	rows: Array<{
		country: string;
		createdAt: Date;
		keyword: string;
		position: number | null;
	}>,
): Map<string, number> {
	const newest = new Map<
		string,
		{ createdAt: Date; position: number | null }
	>();
	for (const row of rows) {
		const key = `${row.country.toLowerCase()}|${row.keyword}`;
		const seen = newest.get(key);
		if (!seen || row.createdAt > seen.createdAt) newest.set(key, row);
	}
	const ranked = new Map<string, number>();
	for (const [key, row] of newest) {
		if (row.position === null) continue;
		const country = key.slice(0, key.indexOf("|"));
		ranked.set(country, (ranked.get(country) ?? 0) + 1);
	}
	return ranked;
}

/** First minute at or after `now` when the auto-research slot fires. */
export function nextAutoResearchAt(
	cfg: ResearchSchedulable & { autoResearchEnabled: boolean },
	now: Date,
	tz: string,
): Date | null {
	if (!cfg.autoResearchEnabled) return null;
	const start = new Date(now);
	start.setUTCSeconds(0, 0);
	start.setUTCMinutes(0);
	for (let i = 0; i <= NEXT_RUN_SEARCH_DAYS * 24; i++) {
		const candidate = new Date(start.getTime() + i * HOUR_MS);
		if (candidate.getTime() < now.getTime()) continue;
		if (isAutoResearchDue(cfg, candidate, tz)) return candidate;
	}
	return null;
}

/** Fixed slots of every scheduled job, for the panel's "Next run" line. */
export function trackingSchedule(
	cfg: ResearchSchedulable & { autoResearchEnabled: boolean },
	store: ResearchStore,
	now = new Date(),
): TrackingSchedule {
	const tz = config.SCHEDULER_TZ || DEFAULT_SCHEDULER_TZ;
	return {
		autoResearchHour: AUTO_RESEARCH_HOUR,
		nextAutoResearchAt: nextAutoResearchAt(cfg, now, tz)?.toISOString() ?? null,
		rankCheckHours: rankCheckHoursFor(store),
		scoreRefreshHour: SCORE_REFRESH_HOUR,
		timezone: tz,
	};
}

/**
 * Per-app rank digest after a scheduled check. Not sent while the workspace
 * daily summary is on: that one morning mail replaces it.
 */
export async function sendRankDigest(cfg: {
	appId: string;
	emailRankDigest: boolean;
	notifyEmail: string | null;
	workspaceId: string;
}): Promise<boolean> {
	if (!cfg.emailRankDigest) return false;
	if (await DailySummaryService.isEnabled(cfg.workspaceId)) {
		log.info(
			{ appId: cfg.appId },
			"Rank digest replaced by the daily summary - not sent",
		);
		return false;
	}
	const positions = await TrackingService.getLatestPositions(cfg.appId);
	if (!positions.length) return false;
	const email = await TrackingService.resolveNotifyEmail(
		cfg.workspaceId,
		cfg.notifyEmail,
	);
	if (!email) return false;
	const app = await AppsService.findOne(cfg.workspaceId, cfg.appId);
	const message = ReportService.buildRankDigest(app.name, positions);
	return reportMail.send({ ...message, to: email });
}

/**
 * Per-app research report after the scheduled auto-research. Not sent while
 * the workspace daily summary is on (it carries the research result).
 */
export async function sendAutoResearchReport(
	cfg: { appId: string; notifyEmail: string | null; workspaceId: string },
	run: { report: unknown; title: string | null },
): Promise<boolean> {
	if (await DailySummaryService.isEnabled(cfg.workspaceId)) {
		log.info(
			{ appId: cfg.appId },
			"Research report replaced by the daily summary - not sent",
		);
		return false;
	}
	const email = await TrackingService.resolveNotifyEmail(
		cfg.workspaceId,
		cfg.notifyEmail,
	);
	if (!email) return false;
	const message = ReportService.buildAutoResearchEmail(
		run.title ?? "your app",
		run.report as ResearchRunReport,
	);
	return reportMail.send({ ...message, to: email });
}

/**
 * Start the app's rank check as a background job and return at once. A
 * throttled check of a few hundred keywords takes tens of minutes; awaiting it
 * here held the whole tick, so the 01:00 / 02:00 / 09:00 slots were silently
 * skipped. The job runner keeps one run per app, so a slot that fires while
 * the previous run is still going does not start a second one.
 */
export async function runScheduledRankCheck(cfg: {
	appId: string;
	emailRankDigest: boolean;
	notifyEmail: string | null;
	workspaceId: string;
}) {
	if (RankCheckJobs.isRunning(cfg.appId)) {
		log.info({ appId: cfg.appId }, "Rank check still running - slot skipped");
		return;
	}
	const started = await RankCheckJobs.startIfSupported(
		cfg.appId,
		cfg.workspaceId,
		"scheduled",
		{
			onComplete: async () => {
				await sendRankDigest(cfg);
			},
		},
	);
	if (!started) {
		log.info({ appId: cfg.appId }, "Store has no searchable results - skipped");
	}
}

/**
 * The nightly keyword-score refresh: one global run for every workspace (see
 * `runScoreCacheRefresh`). Tracked keywords are deduplicated across apps and
 * workspaces and only the stale cache entries of today's slice ask the App
 * Store, through the same process-wide throttle, retry policy and circuit
 * breaker as rank checks. Returns null when today's run already finished.
 */
export async function runScheduledScoreRefresh(
	now = new Date(),
	options: { breakerLimits?: StoreBreakerLimits } = {},
): Promise<ScoreRefreshSummary | null> {
	const tz = config.SCHEDULER_TZ || DEFAULT_SCHEDULER_TZ;
	return runScoreCacheRefresh(localDayKey(now, tz), { ...options, now });
}

/**
 * Score the keyword ideas of one market that were never scored or are older
 * than IDEA_RESCORE_DAYS. Ideas come from stored data (rival titles in the
 * search results of the tracked keywords), so the only store traffic is one
 * App Store search per scored idea, paced by the shared throttle. Google Play
 * is never asked: scores are App Store based for every app.
 */
export async function scoreMarketIdeas(
	cfg: { appId: string; workspaceId: string },
	country: string,
	options: { appstoreId?: string; now?: Date; pace?: StorePacer } = {},
): Promise<number> {
	return (await scoreMarketIdeasDetailed(cfg, country, options)).due;
}

/** `scoreMarketIdeas` plus the scores themselves (for the run's best ideas). */
export async function scoreMarketIdeasDetailed(
	cfg: { appId: string; workspaceId: string },
	country: string,
	options: { appstoreId?: string; now?: Date; pace?: StorePacer } = {},
): Promise<{ due: number; scores: KeywordScore[] }> {
	const { suggestions } = await KeywordSuggestionsService.forMarket(
		cfg.appId,
		cfg.workspaceId,
		country,
	);
	const now = options.now ?? new Date();
	const staleBefore = new Date(now.getTime() - IDEA_RESCORE_DAYS * DAY_MS)
		.toISOString()
		.slice(0, 10);
	const due = suggestions
		.filter((s) => !s.scoredAt || s.scoredAt < staleBefore)
		.slice(0, IDEAS_SCORED_PER_MARKET)
		.map((s) => s.keyword);
	if (!due.length) return { due: 0, scores: [] };
	const scores = await ResearchService.keywordScores(
		due,
		country,
		options.appstoreId,
		cfg.workspaceId,
		{ pace: options.pace },
	);
	return { due: due.length, scores };
}

/** The run's best new ideas by opportunity (scored ones, no errors). */
export function bestIdeas(
	scores: KeywordScore[],
	limit = TOP_IDEAS_RECORDED,
): Array<{ country: string; keyword: string; opportunity: number }> {
	return scores
		.filter((s) => !s.error && Number.isFinite(s.opportunity))
		.sort((a, b) => b.opportunity - a.opportunity)
		.slice(0, limit)
		.map((s) => ({
			country: s.country,
			keyword: s.keyword,
			opportunity: s.opportunity,
		}));
}

/**
 * The 06:00 auto-research. One full research run (store page, reviews, AI)
 * in the app's primary market, then new keyword ideas scored in every market
 * of today's rotation slice (all markets for weekly and monthly runs).
 */
export async function runScheduledAutoResearch(
	cfg: {
		appId: string;
		autoResearchFrequency: string;
		notifyEmail: string | null;
		workspaceId: string;
	},
	now = new Date(),
	options: { breakerLimits?: StoreBreakerLimits } = {},
) {
	const tz = config.SCHEDULER_TZ || DEFAULT_SCHEDULER_TZ;
	const tracked = await TrackingService.getKeywords(cfg.appId);
	const app = await AppsService.findOne(cfg.workspaceId, cfg.appId);
	const home = (app.rawData as { publicCountry?: string } | null)
		?.publicCountry;
	const country = primaryResearchMarket(
		tracked,
		home,
		rankedKeywordsByCountry(
			await TrackingService.getLatestMeasurements(cfg.appId),
		),
	);
	const keywords = tracked
		.filter((k) => k.country.toLowerCase() === country)
		.map((k) => k.keyword);

	const run = await ResearchRunsService.runForApp(cfg.appId, cfg.workspaceId, {
		country,
		deep: false,
		keywords,
		kind: "scheduled",
	});
	await TrackingService.markAutoResearchRun(cfg.appId);

	const markets = marketsForResearchRun(
		tracked.map((k) => k.country),
		cfg.autoResearchFrequency,
		localDayNumber(now, tz),
	);
	const rt = getRankLookupRuntime();
	const breaker = new StoreBreaker(rt.now, options.breakerLimits);
	const pace = breakerPacer("appstore", breaker, rt);
	const appstoreId =
		app.platform === "ios" ? (app.externalId ?? undefined) : undefined;
	let scored = 0;
	const scores: KeywordScore[] = [];
	for (const market of markets) {
		if (breaker.trippedReason) {
			log.warn(
				{ appId: cfg.appId, market, reason: breaker.trippedReason },
				"Keyword ideas stopped by the store breaker",
			);
			break;
		}
		const result = await scoreMarketIdeasDetailed(cfg, market, {
			appstoreId,
			now,
			pace,
		});
		scored += result.due;
		scores.push(...result.scores);
	}
	log.info(
		{ appId: cfg.appId, country, markets: markets.length, scored },
		"Scheduled auto-research complete",
	);

	// Read back by the daily summary ("N ideas scored, best: ...").
	await AppEventsService.record(
		cfg.appId,
		AUTO_RESEARCH_EVENT,
		`Auto-research (${country.toUpperCase()})`,
		{
			country,
			markets: markets.length,
			runId: run.id,
			scored,
			topIdeas: bestIdeas(scores),
		},
	);

	await sendAutoResearchReport(cfg, run);
}

/** Apps whose detached auto-research is still running. */
const researching = new Set<string>();

/** Day key of the score refresh running in this process, if any. */
let scoreRefreshDay: string | null = null;
/** Last day whose score refresh settled (ran or was already done). */
let scoreRefreshSettledDay: string | null = null;

/**
 * Still measuring or researching: the daily summary waits for these. The
 * score refresh is global (one run for every workspace), so while it runs
 * every app counts as busy.
 */
function isAppBusy(appId: string): boolean {
	return (
		RankCheckJobs.isRunning(appId) ||
		researching.has(appId) ||
		scoreRefreshDay !== null
	);
}

async function runDailyCleanups() {
	await KeywordScoresHistoryService.cleanup().catch((err) => {
		log.error({ err }, "Keyword score cleanup failed");
	});
	await KeywordScoreCacheService.cleanup().catch((err) => {
		log.error({ err }, "Keyword score cache cleanup failed");
	});
	await FreeToolQuotaService.cleanup().catch((err) => {
		log.error({ err }, "Free-tool quota cleanup failed");
	});
	await PublicReportsService.cleanupShares().catch((err) => {
		log.error({ err }, "Shared report cleanup failed");
	});
}

// Prevents overlapping ticks: a slow tick (many keywords × network latency)
// could otherwise still be running when the next interval fires, and both
// would pass the due-checks against the not-yet-updated timestamps — causing
// duplicate snapshots, emails and AI spend.
let ticking = false;

async function runTick(now: Date, tz: string) {
	if (ticking) {
		log.info("Previous scheduler tick still running — skipping");
		return;
	}
	ticking = true;
	try {
		const rankConfigs = await TrackingService.listRankTrackingConfigs();
		for (const cfg of rankConfigs) {
			const store = platformToStore(cfg.platform);
			if (!isRankCheckDue({ ...cfg, store }, now, tz)) continue;
			try {
				await runScheduledRankCheck(cfg);
			} catch (err) {
				log.error({ appId: cfg.appId, err }, "Scheduled rank check failed");
			}
		}

		// Detached and one app after another: a run scores ideas in many
		// markets through the shared App Store throttle, which can take a
		// while, and must not hold the tick (the 09:00 reminders) meanwhile.
		const researchConfigs = (
			await TrackingService.listAutoResearchConfigs()
		).filter(
			(cfg) => isAutoResearchDue(cfg, now, tz) && !researching.has(cfg.appId),
		);
		if (researchConfigs.length) {
			for (const cfg of researchConfigs) researching.add(cfg.appId);
			void (async () => {
				for (const cfg of researchConfigs) {
					try {
						await runScheduledAutoResearch(cfg, now);
					} catch (err) {
						log.error(
							{ appId: cfg.appId, err },
							"Scheduled auto-research failed",
						);
					} finally {
						researching.delete(cfg.appId);
					}
				}
			})();
		}

		// Detached: the slice is throttled (minutes to tens of minutes). The
		// cleanups follow a run that actually happened today.
		const refreshDay = localDayKey(now, tz);
		if (
			isScoreRefreshDue(now, tz) &&
			scoreRefreshDay === null &&
			scoreRefreshSettledDay !== refreshDay
		) {
			scoreRefreshDay = refreshDay;
			void runScheduledScoreRefresh(now)
				.then(async (summary) => {
					if (summary) await runDailyCleanups();
				})
				.catch((err) => {
					log.error({ err }, "Scheduled score refresh failed");
				})
				.finally(() => {
					scoreRefreshSettledDay = refreshDay;
					scoreRefreshDay = null;
				});
		}

		await DailySummaryService.runScheduled(now, tz, isAppBusy).catch((err) => {
			log.error({ err }, "Daily summaries failed");
		});

		const { hour, minute } = localHourMinute(now, tz);
		if (hour === DRAFT_REMINDER_HOUR && minute === 0) {
			await DraftReminderService.runScheduled(now).catch((err) => {
				log.error({ err }, "Draft reminders failed");
			});
		}
		if (hour === APPLE_SYNC_HOUR && minute === 0) {
			await AppleAdsService.runScheduledSync().catch((err) => {
				log.error({ err }, "Apple Ads scheduled sync failed");
			});
		}
		if (isAuditRefreshDue(now, tz)) {
			await AuditService.refreshAll().catch((err) => {
				log.error({ err }, "Weekly audit sweep failed");
			});
		}
	} catch (err) {
		log.error({ err }, "Scheduler tick failed");
	} finally {
		ticking = false;
	}
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
	if (config.SCHEDULER_ENABLED === "false") {
		log.info("Scheduler disabled via SCHEDULER_ENABLED=false");
		return;
	}
	if (config.NODE_ENV === "test") return;
	if (timer) return;
	const tz = config.SCHEDULER_TZ || DEFAULT_SCHEDULER_TZ;
	timer = setInterval(() => {
		void runTick(new Date(), tz);
	}, TICK_MS);
	log.info({ tz }, "Rank-tracking scheduler started");
}

export function stopScheduler() {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
}

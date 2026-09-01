import config from "@/config";
import { AppleAdsService } from "@/modules/apple-ads/apple-ads.service";
import { AppsService } from "@/modules/apps/apps.service";
import { FreeToolQuotaService } from "@/modules/public-reports/quota.service";
import { KeywordScoresHistoryService } from "@/modules/research/keyword-scores-history.service";
import { ResearchRunsService } from "@/modules/research/research.runs.service";
import { ResearchService } from "@/modules/research/research.service";
import type { ResearchRunReport } from "@/modules/research/research.types";
import { createLogger } from "@/utils/logger";
import { sendMail } from "@/utils/mailer";
import { ReportService } from "./report.service";
import { TrackingService } from "./tracking.service";
import {
	type AutoResearchFrequency,
	DEFAULT_SCHEDULER_TZ,
	RANK_CHECK_HOURS,
} from "./tracking.types";

const log = createLogger("scheduler");

const TICK_MS = 60_000;
// Guard against a slot re-firing within the same window (e.g. after a restart
// at 12:00). The two rank-check slots are 12h apart, so 6h is a safe gap.
const MIN_RANK_GAP_MS = 6 * 60 * 60 * 1000;
// Auto-research is evaluated once a day at midnight, then gated by frequency.
const AUTO_RESEARCH_HOUR = 0;
// Keyword-score refresh runs daily at 01:00 local (offset from the midnight
// rank check so the two batches never hammer iTunes at the same time).
const SCORE_REFRESH_HOUR = 1;
// Apple Ads dataset sync runs daily at 02:00; it no-ops for countries whose
// newest completed week is already active, so it only downloads on Mondays.
const APPLE_SYNC_HOUR = 2;
const MIN_SCORE_REFRESH_GAP_MS = 20 * 60 * 60 * 1000;
const SCORE_KEYWORDS_PER_CALL = 10;
const FREQUENCY_DAYS: Record<AutoResearchFrequency, number> = {
	daily: 1,
	monthly: 30,
	weekly: 7,
};
// Fire a day/week/month interval slightly early to absorb tick jitter.
const FREQUENCY_GRACE_MS = 60 * 60 * 1000;

interface RankSchedulable {
	lastRankCheckAt: Date | null;
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

export function isRankCheckDue(
	cfg: RankSchedulable,
	now: Date,
	tz: string,
): boolean {
	const { hour, minute } = localHourMinute(now, tz);
	if (minute !== 0 || !RANK_CHECK_HOURS.includes(hour as 0 | 12)) return false;
	if (!cfg.lastRankCheckAt) return true;
	return (
		now.getTime() - new Date(cfg.lastRankCheckAt).getTime() >= MIN_RANK_GAP_MS
	);
}

export function isScoreRefreshDue(
	cfg: { lastScoreRefreshAt: Date | null },
	now: Date,
	tz: string,
): boolean {
	const { hour, minute } = localHourMinute(now, tz);
	if (minute !== 0 || hour !== SCORE_REFRESH_HOUR) return false;
	if (!cfg.lastScoreRefreshAt) return true;
	return (
		now.getTime() - new Date(cfg.lastScoreRefreshAt).getTime() >=
		MIN_SCORE_REFRESH_GAP_MS
	);
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

async function runScheduledRankCheck(cfg: {
	appId: string;
	emailRankDigest: boolean;
	notifyEmail: string | null;
	workspaceId: string;
}) {
	await TrackingService.runRankCheck(cfg.appId, cfg.workspaceId, "scheduled");
	if (!cfg.emailRankDigest) return;
	const positions = await TrackingService.getLatestPositions(cfg.appId);
	if (!positions.length) return;
	const email = await TrackingService.resolveNotifyEmail(
		cfg.workspaceId,
		cfg.notifyEmail,
	);
	if (!email) return;
	const app = await AppsService.findOne(cfg.workspaceId, cfg.appId);
	const message = ReportService.buildRankDigest(app.name, positions);
	await sendMail({ ...message, to: email });
}

/**
 * Refresh keyword-score snapshots for every tracked keyword of an app, one
 * country at a time. iOS apps also get their rank refreshed via the app's
 * store id. The scoring path persists snapshots itself (workspaceId given).
 */
async function runScheduledScoreRefresh(cfg: {
	appId: string;
	workspaceId: string;
}) {
	const tracked = await TrackingService.getKeywords(cfg.appId);
	if (!tracked.length) return;
	const app = await AppsService.findOne(cfg.workspaceId, cfg.appId);
	const appstoreId =
		app.platform === "ios" ? (app.externalId ?? undefined) : undefined;

	const byCountry = new Map<string, string[]>();
	for (const k of tracked) {
		byCountry.set(k.country, [...(byCountry.get(k.country) ?? []), k.keyword]);
	}
	for (const [country, keywords] of byCountry) {
		for (
			let start = 0;
			start < keywords.length;
			start += SCORE_KEYWORDS_PER_CALL
		) {
			await ResearchService.keywordScores(
				keywords.slice(start, start + SCORE_KEYWORDS_PER_CALL),
				country,
				appstoreId,
				cfg.workspaceId,
			);
		}
	}
	await TrackingService.markScoreRefreshRun(cfg.appId);
}

async function runScheduledAutoResearch(cfg: {
	appId: string;
	notifyEmail: string | null;
	workspaceId: string;
}) {
	const tracked = await TrackingService.getKeywords(cfg.appId);
	const country = tracked[0]?.country ?? "us";
	const keywords = tracked
		.filter((k) => k.country === country)
		.map((k) => k.keyword);

	const run = await ResearchRunsService.runForApp(cfg.appId, cfg.workspaceId, {
		country,
		deep: false,
		keywords,
		kind: "scheduled",
	});
	await TrackingService.markAutoResearchRun(cfg.appId);

	const email = await TrackingService.resolveNotifyEmail(
		cfg.workspaceId,
		cfg.notifyEmail,
	);
	if (!email) return;
	const message = ReportService.buildAutoResearchEmail(
		run.title ?? "your app",
		run.report as ResearchRunReport,
	);
	await sendMail({ ...message, to: email });
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
			if (!isRankCheckDue(cfg, now, tz)) continue;
			try {
				await runScheduledRankCheck(cfg);
			} catch (err) {
				log.error({ appId: cfg.appId, err }, "Scheduled rank check failed");
			}
		}

		const researchConfigs = await TrackingService.listAutoResearchConfigs();
		for (const cfg of researchConfigs) {
			if (!isAutoResearchDue(cfg, now, tz)) continue;
			try {
				await runScheduledAutoResearch(cfg);
			} catch (err) {
				log.error({ appId: cfg.appId, err }, "Scheduled auto-research failed");
			}
		}

		let scoresRefreshed = false;
		for (const cfg of rankConfigs) {
			if (!isScoreRefreshDue(cfg, now, tz)) continue;
			try {
				await runScheduledScoreRefresh(cfg);
				scoresRefreshed = true;
			} catch (err) {
				log.error({ appId: cfg.appId, err }, "Scheduled score refresh failed");
			}
		}
		if (scoresRefreshed) {
			await KeywordScoresHistoryService.cleanup().catch((err) => {
				log.error({ err }, "Keyword score cleanup failed");
			});
			await FreeToolQuotaService.cleanup().catch((err) => {
				log.error({ err }, "Free-tool quota cleanup failed");
			});
		}

		const { hour, minute } = localHourMinute(now, tz);
		if (hour === APPLE_SYNC_HOUR && minute === 0) {
			await AppleAdsService.runScheduledSync().catch((err) => {
				log.error({ err }, "Apple Ads scheduled sync failed");
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

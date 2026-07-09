import config from "@/config";
import { AppsService } from "@/modules/apps/apps.service";
import { ResearchRunsService } from "@/modules/research/research.runs.service";
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

import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import config from "@/config";
import { isBrandKeyword } from "@/modules/research/listing-audit";
import { TrackingMarketsService } from "@/modules/tracking/markets.service";
import { reportMail } from "@/modules/tracking/report-mail";
import { TrackingService } from "@/modules/tracking/tracking.service";
import { DEFAULT_SCHEDULER_TZ } from "@/modules/tracking/tracking.types";
import { db } from "@/utils/db";
import {
	appEvents,
	appTrackingConfig,
	researchRuns,
	workspaceDailySummary,
} from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import { checkRateLimit, rateLimitEnabled } from "@/utils/rate-limit";
import {
	buildDailySummaryEmail,
	pickMovers,
	starredSummary,
	strongestMarkets,
	summarizeTotals,
} from "./daily-summary.builder";
import {
	isDailySummaryDue,
	localDateKey,
	mayWaitForJobs,
} from "./daily-summary.schedule";
import {
	DAILY_SUMMARY_HOUR,
	DAILY_SUMMARY_MINUTE,
	type DailySummary,
	type DailySummaryApp,
	type DailySummarySettings,
	DEFAULT_PANEL_URL,
	SUMMARY_IDEAS_LIMIT,
	type SummaryIdea,
	type SummaryResearch,
	TEST_SEND_MAX_PER_HOUR,
} from "./daily-summary.types";

const log = createLogger("daily-summary");

const HOUR_MS = 60 * 60 * 1000;
/** App event written by every scheduled auto-research (ideas scored). */
export const AUTO_RESEARCH_EVENT = "auto_research_completed";

export interface DailySummaryPatch {
	email?: string | null;
	enabled?: boolean;
}

export interface DailySummarySendResult {
	apps: number;
	sent: boolean;
	to: string | null;
}

type CoveredConfig = typeof appTrackingConfig.$inferSelect;

function schedulerTz(): string {
	return config.SCHEDULER_TZ || DEFAULT_SCHEDULER_TZ;
}

function dashboardUrl(appId: string): string {
	const base = (config.PANEL_URL || DEFAULT_PANEL_URL).replace(/\/+$/, "");
	return `${base}/apps/${appId}/dashboard`;
}

function readIdeas(value: unknown): SummaryIdea[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(i): i is SummaryIdea =>
				!!i &&
				typeof i === "object" &&
				typeof (i as SummaryIdea).keyword === "string" &&
				typeof (i as SummaryIdea).country === "string" &&
				typeof (i as SummaryIdea).opportunity === "number",
		)
		.slice(0, SUMMARY_IDEAS_LIMIT);
}

function readNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One morning email per workspace that replaces the per-app rank digests and
 * research reports while it is on. Settings live in `workspace_daily_summary`;
 * a workspace without a row behaves exactly as before (summary off).
 */
export class DailySummaryService {
	static async getRow(workspaceId: string) {
		const [row] = await db
			.select()
			.from(workspaceDailySummary)
			.where(eq(workspaceDailySummary.workspaceId, workspaceId))
			.limit(1);
		return row ?? null;
	}

	/** True when the per-app digests and research reports are replaced. */
	static async isEnabled(workspaceId: string): Promise<boolean> {
		const row = await DailySummaryService.getRow(workspaceId);
		return row?.enabled ?? false;
	}

	/** Apps the summary covers: rank tracking or auto-research switched on. */
	static async coveredConfigs(workspaceId: string): Promise<CoveredConfig[]> {
		return db
			.select()
			.from(appTrackingConfig)
			.where(
				and(
					eq(appTrackingConfig.workspaceId, workspaceId),
					or(
						eq(appTrackingConfig.rankTrackingEnabled, true),
						eq(appTrackingConfig.autoResearchEnabled, true),
					),
				),
			)
			.orderBy(appTrackingConfig.createdAt);
	}

	/**
	 * Where the summary goes: the workspace setting, else the first per-app
	 * report email of the workspace, else the owner's account email.
	 */
	static async resolveRecipient(
		workspaceId: string,
		email: string | null | undefined,
	): Promise<string | null> {
		if (email) return email;
		const [perApp] = await db
			.select({ email: appTrackingConfig.notifyEmail })
			.from(appTrackingConfig)
			.where(
				and(
					eq(appTrackingConfig.workspaceId, workspaceId),
					ne(appTrackingConfig.notifyEmail, ""),
				),
			)
			.orderBy(appTrackingConfig.createdAt)
			.limit(1);
		return TrackingService.resolveNotifyEmail(
			workspaceId,
			perApp?.email ?? null,
		);
	}

	static async getSettings(workspaceId: string): Promise<DailySummarySettings> {
		const row = await DailySummaryService.getRow(workspaceId);
		const [effectiveEmail, covered] = await Promise.all([
			DailySummaryService.resolveRecipient(workspaceId, row?.email),
			DailySummaryService.coveredConfigs(workspaceId),
		]);
		return {
			effectiveEmail,
			email: row?.email ?? null,
			enabled: row?.enabled ?? false,
			lastSentAt: row?.lastSentAt ?? null,
			schedule: {
				hour: DAILY_SUMMARY_HOUR,
				minute: DAILY_SUMMARY_MINUTE,
				timezone: schedulerTz(),
			},
			trackedApps: covered.length,
		};
	}

	static async updateSettings(
		workspaceId: string,
		patch: DailySummaryPatch,
	): Promise<DailySummarySettings> {
		const values: DailySummaryPatch = {};
		if (patch.enabled !== undefined) values.enabled = patch.enabled;
		if (patch.email !== undefined) {
			values.email = patch.email?.trim() ? patch.email.trim() : null;
		}
		await db
			.insert(workspaceDailySummary)
			.values({ ...values, workspaceId })
			.onConflictDoUpdate({
				set: { ...values, updatedAt: new Date() },
				target: workspaceDailySummary.workspaceId,
			});
		log.info(
			{ enabled: values.enabled, workspaceId },
			"Daily summary settings updated",
		);
		return DailySummaryService.getSettings(workspaceId);
	}

	/** Latest scheduled research run of the app plus the ideas it scored. */
	static async latestResearch(
		appId: string,
		workspaceId: string,
	): Promise<SummaryResearch | null> {
		const [run] = await db
			.select({
				country: researchRuns.country,
				createdAt: researchRuns.createdAt,
				id: researchRuns.id,
				report: researchRuns.report,
			})
			.from(researchRuns)
			.where(
				and(
					eq(researchRuns.appId, appId),
					eq(researchRuns.workspaceId, workspaceId),
					eq(researchRuns.kind, "scheduled"),
				),
			)
			.orderBy(desc(researchRuns.createdAt))
			.limit(1);
		if (!run) return null;

		const [event] = await db
			.select({ meta: appEvents.meta })
			.from(appEvents)
			.where(
				and(
					eq(appEvents.appId, appId),
					eq(appEvents.type, AUTO_RESEARCH_EVENT),
				),
			)
			.orderBy(desc(appEvents.occurredAt))
			.limit(1);
		const meta = event?.meta?.runId === run.id ? event.meta : null;

		const report = run.report;
		return {
			at: run.createdAt,
			country: run.country ?? report.meta?.country ?? "",
			ideaMarkets: readNumber(meta?.markets),
			ideasScored: readNumber(meta?.scored),
			negativeShare: readNumber(report.heuristics?.negativeShare),
			rating: readNumber(report.meta?.rating),
			reviewsCount: report.reviewsCount ?? 0,
			summary: report.analysis?.summary ?? null,
			topIdeas: readIdeas(meta?.topIdeas),
		};
	}

	static async collectApp(
		cfg: CoveredConfig,
		workspaceId: string,
	): Promise<DailySummaryApp> {
		const [overview, positions, keywords, research] = await Promise.all([
			TrackingMarketsService.getMarkets(cfg.appId, workspaceId),
			TrackingService.getLatestPositions(cfg.appId),
			TrackingService.getKeywords(cfg.appId),
			DailySummaryService.latestResearch(cfg.appId, workspaceId),
		]);
		const name = overview.app.name;
		const isBrand = (keyword: string) => isBrandKeyword(keyword, name);
		const { drops, gains } = pickMovers(positions, isBrand);
		const starredKeys = new Set(
			keywords.filter((k) => k.starred).map((k) => `${k.country}|${k.keyword}`),
		);
		const totals = overview.totals;
		return {
			appId: cfg.appId,
			dashboardUrl: dashboardUrl(cfg.appId),
			declined: totals.declined,
			devices: overview.app.devices,
			dropped: totals.dropped,
			drops,
			entered: totals.entered,
			gains,
			improved: totals.improved,
			lastCheckedAt: totals.lastCheckedAt,
			name,
			platform: overview.app.platform,
			ranked: totals.earnedRanked,
			rankTrackingSupported: overview.rankTracking.supported,
			research,
			starred: starredSummary(positions, starredKeys),
			strongestMarkets: strongestMarkets(overview.markets),
			top10: totals.earnedTop10,
			tracked: totals.tracked,
		};
	}

	static async collect(
		workspaceId: string,
		now = new Date(),
		configs?: CoveredConfig[],
	): Promise<DailySummary> {
		const covered =
			configs ?? (await DailySummaryService.coveredConfigs(workspaceId));
		const apps: DailySummaryApp[] = [];
		for (const cfg of covered) {
			try {
				apps.push(await DailySummaryService.collectApp(cfg, workspaceId));
			} catch (err) {
				// One broken app must not cost the whole workspace its summary.
				log.error(
					{ appId: cfg.appId, err, workspaceId },
					"Daily summary: app skipped",
				);
			}
		}
		apps.sort((a, b) => a.name.localeCompare(b.name));
		return {
			apps,
			generatedAt: now,
			timezone: schedulerTz(),
			totals: summarizeTotals(apps),
		};
	}

	/** Build and mail the summary to the configured recipient. */
	static async send(
		workspaceId: string,
		now = new Date(),
		configs?: CoveredConfig[],
	): Promise<DailySummarySendResult> {
		const row = await DailySummaryService.getRow(workspaceId);
		const to = await DailySummaryService.resolveRecipient(
			workspaceId,
			row?.email,
		);
		if (!to) {
			log.warn({ workspaceId }, "Daily summary: no recipient");
			return { apps: 0, sent: false, to: null };
		}
		const summary = await DailySummaryService.collect(
			workspaceId,
			now,
			configs,
		);
		if (!summary.apps.length) return { apps: 0, sent: false, to };
		const message = buildDailySummaryEmail(summary);
		const sent = await reportMail.send({ ...message, to });
		return { apps: summary.apps.length, sent, to };
	}

	/** "Send a test summary now": same mail, no effect on the daily guard. */
	static async sendTest(workspaceId: string): Promise<DailySummarySendResult> {
		if (
			rateLimitEnabled() &&
			!checkRateLimit(
				`daily-summary-test:${workspaceId}`,
				TEST_SEND_MAX_PER_HOUR,
				HOUR_MS,
			)
		) {
			buildError("rateLimitExceeded", {
				info: "Too many test summaries. Try again in an hour.",
			});
		}
		if (!reportMail.isConfigured()) {
			buildError("mailUnavailable", {
				info: "Email is not configured on this server (SMTP).",
			});
		}
		const configs = await DailySummaryService.coveredConfigs(workspaceId);
		if (!configs.length) {
			buildError("badRequest", {
				info: "Turn on rank tracking or auto-research for at least one app first.",
			});
		}
		const result = await DailySummaryService.send(
			workspaceId,
			new Date(),
			configs,
		);
		if (!result.to) {
			buildError("badRequest", { info: "No recipient email address." });
		}
		if (!result.sent) {
			buildError("mailUnavailable", { info: "The email could not be sent." });
		}
		return result;
	}

	/**
	 * Take today's slot for the workspace. A single conditional UPDATE, so a
	 * restart, an overlapping tick or a second instance can never send twice.
	 */
	static async claimDay(workspaceId: string, day: string): Promise<boolean> {
		const claimed = await db
			.update(workspaceDailySummary)
			.set({ lastSentOn: day })
			.where(
				and(
					eq(workspaceDailySummary.workspaceId, workspaceId),
					eq(workspaceDailySummary.enabled, true),
					or(
						isNull(workspaceDailySummary.lastSentOn),
						ne(workspaceDailySummary.lastSentOn, day),
					),
				),
			)
			.returning({ id: workspaceDailySummary.id });
		return claimed.length > 0;
	}

	/**
	 * Scheduler entry: every enabled workspace whose summary is due gets one
	 * mail. `isBusy` tells whether an app still has a rank check or research
	 * running; until 09:30 the summary waits for those.
	 */
	static async runScheduled(
		now: Date,
		tz: string,
		isBusy: (appId: string) => boolean = () => false,
	): Promise<number> {
		if (!reportMail.isConfigured()) return 0;
		const rows = await db
			.select()
			.from(workspaceDailySummary)
			.where(eq(workspaceDailySummary.enabled, true));
		let sent = 0;
		for (const row of rows) {
			if (!isDailySummaryDue(row, now, tz)) continue;
			try {
				const configs = await DailySummaryService.coveredConfigs(
					row.workspaceId,
				);
				if (!configs.length) continue;
				if (mayWaitForJobs(now, tz) && configs.some((c) => isBusy(c.appId))) {
					log.debug(
						{ workspaceId: row.workspaceId },
						"Daily summary waits for running jobs",
					);
					continue;
				}
				const claimed = await DailySummaryService.claimDay(
					row.workspaceId,
					localDateKey(now, tz),
				);
				if (!claimed) continue;
				const result = await DailySummaryService.send(
					row.workspaceId,
					now,
					configs,
				);
				if (result.sent) {
					sent += 1;
					await db
						.update(workspaceDailySummary)
						.set({ lastSentAt: now })
						.where(eq(workspaceDailySummary.workspaceId, row.workspaceId));
				}
				log.info(
					{
						apps: result.apps,
						sent: result.sent,
						workspaceId: row.workspaceId,
					},
					"Daily summary",
				);
			} catch (err) {
				log.error(
					{ err, workspaceId: row.workspaceId },
					"Daily summary failed",
				);
			}
		}
		return sent;
	}
}

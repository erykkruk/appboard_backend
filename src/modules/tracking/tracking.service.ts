import { and, asc, desc, eq } from "drizzle-orm";
import { AppsService } from "@/modules/apps/apps.service";
import { HistoryService } from "@/modules/history/history.service";
import { ResearchService } from "@/modules/research/research.service";
import { platformToStore } from "@/modules/research/research.types";
import { db } from "@/utils/db";
import {
	appTrackingConfig,
	rankSnapshots,
	trackedKeywords,
	user,
	workspaceMembers,
} from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import {
	AUTO_RESEARCH_FREQUENCIES,
	type AutoResearchFrequency,
	type LatestPosition,
	MAX_KEYWORDS_PER_COUNTRY,
	type RankCheckResult,
} from "./tracking.types";

const log = createLogger("tracking");

// How far back to look when computing latest position + day-over-day delta.
const LATEST_LOOKBACK_LIMIT = 2000;

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

	/**
	 * Add keywords for a country, capped at MAX_KEYWORDS_PER_COUNTRY. Existing
	 * duplicates are ignored. Rejects with 422 when the cap would be exceeded.
	 */
	static async addKeywords(appId: string, country: string, keywords: string[]) {
		// Normalize country + keywords to lowercase so the unique constraint and
		// rank-snapshot grouping stay consistent regardless of caller casing.
		const cc = country.toLowerCase();
		const cleaned = [
			...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)),
		];
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

	/**
	 * Measure the current search position of every tracked keyword and persist a
	 * snapshot per (keyword, country). Positions come from the same store clients
	 * the research tool uses. Updates `lastRankCheckAt`.
	 */
	static async runRankCheck(
		appId: string,
		workspaceId: string,
		kind: "manual" | "scheduled" = "manual",
	): Promise<RankCheckResult> {
		const app = await AppsService.findOne(workspaceId, appId);
		const store = platformToStore(app.platform);
		const keywords = await TrackingService.getKeywords(appId);

		let snapshots = 0;
		for (const { country, keyword } of keywords) {
			const position = await ResearchService.positionFor(
				store,
				keyword,
				app.externalId,
				country,
			);
			await db.insert(rankSnapshots).values({
				appId,
				country,
				keyword,
				platform: store,
				position,
			});
			snapshots++;
		}

		await db
			.update(appTrackingConfig)
			.set({ lastRankCheckAt: new Date() })
			.where(eq(appTrackingConfig.appId, appId));

		log.info({ appId, kind, snapshots }, "Rank check complete");
		return { checked: keywords.length, snapshots };
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
		const snapshots = await db
			.select()
			.from(rankSnapshots)
			.where(and(...conditions))
			.orderBy(asc(rankSnapshots.createdAt));

		// Listing changes overlaid on the chart as vertical annotations.
		const history = await HistoryService.getHistory(appId);
		const annotations = history.map((h) => ({
			date: h.publishedAt ?? h.createdAt,
			field: h.field,
			language: h.language,
			newValue: h.newValue,
			oldValue: h.oldValue,
		}));

		return { annotations, snapshots };
	}

	/** Latest position per (keyword, country, platform) with day-over-day delta. */
	static async getLatestPositions(appId: string): Promise<LatestPosition[]> {
		const rows = await db
			.select()
			.from(rankSnapshots)
			.where(eq(rankSnapshots.appId, appId))
			.orderBy(desc(rankSnapshots.createdAt))
			.limit(LATEST_LOOKBACK_LIMIT);

		const grouped = new Map<string, typeof rows>();
		for (const row of rows) {
			const key = `${row.platform}|${row.country}|${row.keyword}`;
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

	static async listRankTrackingConfigs() {
		return db
			.select()
			.from(appTrackingConfig)
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
}

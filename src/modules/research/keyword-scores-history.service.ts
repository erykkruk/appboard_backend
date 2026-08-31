import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { keywordScoreSnapshots } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import type { KeywordScore } from "./research.types";

const log = createLogger("keyword-scores-history");

const RETENTION_DAYS = 90;
const DEFAULT_TREND_DAYS = 90;
const MAX_LIST_ROWS = 200;

/** Today's date (UTC) in the YYYY-MM-DD form the `day` column stores. */
function todayUtc(): string {
	return new Date().toISOString().slice(0, 10);
}

function dayCutoff(days: number): string {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);
}

/**
 * Daily keyword-scoring history: one snapshot per workspace+keyword+country+day.
 * Manual searches and the scheduled refresh both upsert the same day row, so
 * trends stay one-point-per-day regardless of how often a keyword is scored.
 */
export class KeywordScoresHistoryService {
	/** Best-effort upsert of today's snapshots. Failed scores are skipped. */
	static async upsertToday(
		workspaceId: string,
		scores: KeywordScore[],
	): Promise<void> {
		const day = todayUtc();
		const rows = scores
			.filter((score) => !score.error)
			.map((score) => ({
				appRank: score.appRank ?? null,
				classification: score.classification,
				country: score.country,
				day,
				difficulty: score.difficulty,
				keyword: score.keyword,
				opportunity: score.opportunity,
				payload: score,
				popularity: score.popularity,
				workspaceId,
			}));
		if (!rows.length) return;
		await db
			.insert(keywordScoreSnapshots)
			.values(rows)
			.onConflictDoUpdate({
				set: {
					appRank: sql`excluded.app_rank`,
					classification: sql`excluded.classification`,
					difficulty: sql`excluded.difficulty`,
					opportunity: sql`excluded.opportunity`,
					payload: sql`excluded.payload`,
					popularity: sql`excluded.popularity`,
					updatedAt: new Date(),
				},
				target: [
					keywordScoreSnapshots.workspaceId,
					keywordScoreSnapshots.keyword,
					keywordScoreSnapshots.country,
					keywordScoreSnapshots.day,
				],
			});
	}

	/**
	 * Latest snapshot per keyword+country (payload omitted - fetch a single
	 * entry for the full breakdown). Optionally filtered by keyword/country.
	 */
	static async list(
		workspaceId: string,
		filters: { country?: string; keyword?: string } = {},
	) {
		const conditions = [eq(keywordScoreSnapshots.workspaceId, workspaceId)];
		if (filters.country) {
			conditions.push(eq(keywordScoreSnapshots.country, filters.country));
		}
		if (filters.keyword) {
			conditions.push(eq(keywordScoreSnapshots.keyword, filters.keyword));
		}
		return db
			.selectDistinctOn(
				[keywordScoreSnapshots.keyword, keywordScoreSnapshots.country],
				{
					appRank: keywordScoreSnapshots.appRank,
					classification: keywordScoreSnapshots.classification,
					country: keywordScoreSnapshots.country,
					day: keywordScoreSnapshots.day,
					difficulty: keywordScoreSnapshots.difficulty,
					id: keywordScoreSnapshots.id,
					keyword: keywordScoreSnapshots.keyword,
					opportunity: keywordScoreSnapshots.opportunity,
					popularity: keywordScoreSnapshots.popularity,
				},
			)
			.from(keywordScoreSnapshots)
			.where(and(...conditions))
			.orderBy(
				keywordScoreSnapshots.keyword,
				keywordScoreSnapshots.country,
				desc(keywordScoreSnapshots.day),
			)
			.limit(MAX_LIST_ROWS);
	}

	/** One snapshot with its full payload (breakdown, tiers, competitors). */
	static async get(workspaceId: string, id: string) {
		const [row] = await db
			.select()
			.from(keywordScoreSnapshots)
			.where(
				and(
					eq(keywordScoreSnapshots.id, id),
					eq(keywordScoreSnapshots.workspaceId, workspaceId),
				),
			)
			.limit(1);
		if (!row) buildError("notFound", { info: "Snapshot not found" });
		return row;
	}

	static async delete(workspaceId: string, id: string) {
		const deleted = await db
			.delete(keywordScoreSnapshots)
			.where(
				and(
					eq(keywordScoreSnapshots.id, id),
					eq(keywordScoreSnapshots.workspaceId, workspaceId),
				),
			)
			.returning({ id: keywordScoreSnapshots.id });
		if (!deleted.length) buildError("notFound", { info: "Snapshot not found" });
		return { success: true };
	}

	/** Daily trend points for one keyword+country, oldest first. */
	static async trend(
		workspaceId: string,
		keyword: string,
		country: string,
		days = DEFAULT_TREND_DAYS,
	) {
		return db
			.select({
				appRank: keywordScoreSnapshots.appRank,
				classification: keywordScoreSnapshots.classification,
				day: keywordScoreSnapshots.day,
				difficulty: keywordScoreSnapshots.difficulty,
				opportunity: keywordScoreSnapshots.opportunity,
				popularity: keywordScoreSnapshots.popularity,
			})
			.from(keywordScoreSnapshots)
			.where(
				and(
					eq(keywordScoreSnapshots.workspaceId, workspaceId),
					eq(keywordScoreSnapshots.keyword, keyword.toLowerCase().trim()),
					eq(keywordScoreSnapshots.country, country),
					gte(keywordScoreSnapshots.day, dayCutoff(days)),
				),
			)
			.orderBy(keywordScoreSnapshots.day);
	}

	/** Drop snapshots older than the retention window. Returns rows removed. */
	static async cleanup(retentionDays = RETENTION_DAYS): Promise<number> {
		const removed = await db
			.delete(keywordScoreSnapshots)
			.where(lt(keywordScoreSnapshots.day, dayCutoff(retentionDays)))
			.returning({ id: keywordScoreSnapshots.id });
		if (removed.length) {
			log.info({ removed: removed.length }, "Keyword score retention cleanup");
		}
		return removed.length;
	}
}

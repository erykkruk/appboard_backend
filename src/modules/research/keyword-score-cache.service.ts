import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { keywordScoreCache } from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";
import type { KeywordCompetitor } from "./research.types";

const log = createLogger("keyword-score-cache");

const DAY_MS = 24 * 60 * 60 * 1000;

/** A cached store answer is served for this long, to every workspace. */
export const KEYWORD_SCORE_CACHE_TTL_DAYS = 7;
/** Entries nobody tracked or asked for in this long are dropped. */
const CACHE_RETENTION_DAYS = 60;

export interface CachedKeywordSearch {
	competitors: KeywordCompetitor[];
	country: string;
	keyword: string;
	scoredAt: Date;
}

/** The cache key form: the same normalization keywordScores applies. */
export function normalizeCacheKeyword(keyword: string): string {
	return keyword.trim().toLowerCase();
}

export function cacheCutoff(now: Date, days: number): Date {
	return new Date(now.getTime() - days * DAY_MS);
}

/**
 * Global (cross-workspace) cache of the App Store keyword search a score is
 * computed from, keyed by (keyword, country). Only store-derived data lives
 * here; anything that depends on the asking app or workspace (own rank,
 * Apple Ads popularity source) is computed per request on top of it.
 */
export class KeywordScoreCacheService {
	/**
	 * Entries for these keywords in one country, newest store answer only.
	 * With `freshSince`, older entries are left out (treated as a miss).
	 */
	static async getMany(
		keywords: string[],
		country: string,
		options: { freshSince?: Date } = {},
	): Promise<Map<string, CachedKeywordSearch>> {
		const keys = [...new Set(keywords.map(normalizeCacheKeyword))].filter(
			Boolean,
		);
		const out = new Map<string, CachedKeywordSearch>();
		if (!keys.length) return out;
		const cc = country.toLowerCase();
		const rows = await db
			.select({
				competitors: keywordScoreCache.competitors,
				country: keywordScoreCache.country,
				keyword: keywordScoreCache.keyword,
				scoredAt: keywordScoreCache.scoredAt,
			})
			.from(keywordScoreCache)
			.where(
				and(
					eq(keywordScoreCache.country, cc),
					inArray(keywordScoreCache.keyword, keys),
					options.freshSince
						? gte(keywordScoreCache.scoredAt, options.freshSince)
						: undefined,
				),
			);
		for (const row of rows) out.set(row.keyword, row);
		return out;
	}

	/** When each of these keywords was last asked (no payload). */
	static async scoredAtMany(
		keywords: string[],
		country: string,
	): Promise<Map<string, Date>> {
		const keys = [...new Set(keywords.map(normalizeCacheKeyword))].filter(
			Boolean,
		);
		if (!keys.length) return new Map();
		const rows = await db
			.select({
				keyword: keywordScoreCache.keyword,
				scoredAt: keywordScoreCache.scoredAt,
			})
			.from(keywordScoreCache)
			.where(
				and(
					eq(keywordScoreCache.country, country.toLowerCase()),
					inArray(keywordScoreCache.keyword, keys),
				),
			);
		return new Map(rows.map((r) => [r.keyword, r.scoredAt]));
	}

	/** Entries still inside the TTL at `now`. */
	static async getFresh(
		keywords: string[],
		country: string,
		now = new Date(),
	): Promise<Map<string, CachedKeywordSearch>> {
		return KeywordScoreCacheService.getMany(keywords, country, {
			freshSince: cacheCutoff(now, KEYWORD_SCORE_CACHE_TTL_DAYS),
		});
	}

	/** Store (or replace) the store answer for one (keyword, country). */
	static async put(
		keyword: string,
		country: string,
		competitors: KeywordCompetitor[],
		scoredAt = new Date(),
	): Promise<CachedKeywordSearch> {
		const entry = {
			competitors,
			country: country.toLowerCase(),
			keyword: normalizeCacheKeyword(keyword),
			scoredAt,
		};
		await db
			.insert(keywordScoreCache)
			.values(entry)
			.onConflictDoUpdate({
				set: {
					competitors: sql`excluded.competitors`,
					scoredAt: sql`excluded.scored_at`,
					updatedAt: new Date(),
				},
				target: [keywordScoreCache.keyword, keywordScoreCache.country],
			});
		return entry;
	}

	/** Drop entries not refreshed in the retention window. Returns rows removed. */
	static async cleanup(
		now = new Date(),
		retentionDays = CACHE_RETENTION_DAYS,
	): Promise<number> {
		const removed = await db
			.delete(keywordScoreCache)
			.where(lt(keywordScoreCache.scoredAt, cacheCutoff(now, retentionDays)))
			.returning({ id: keywordScoreCache.id });
		if (removed.length) {
			log.info({ removed: removed.length }, "Keyword score cache cleanup");
		}
		return removed.length;
	}
}

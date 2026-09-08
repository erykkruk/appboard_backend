import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { HistoryService } from "@/modules/history/history.service";
import { langFor } from "@/modules/research/playstore.client";
import type {
	KeywordClassification,
	KeywordScore,
} from "@/modules/research/scoring-types";
import { db } from "@/utils/db";
import {
	keywordScoreSnapshots,
	listings,
	rankSnapshots,
	trackedKeywords,
} from "@/utils/db/schema";
import { AppEventsService, CHART_EVENT_TYPES } from "./app-events.service";
import {
	BOARD_TREND_POINTS,
	type BoardChange,
	type BoardGap,
	type BoardKeyword,
	type BoardLeader,
	type BoardMove,
	type BoardRankPoint,
	type BoardRun,
	type BoardScorePoint,
	type BoardStats,
	MAX_PICK_DIFFICULTY,
	type MetadataField,
	PICK_CLASSIFICATIONS,
	type TrackingBoard,
} from "./board.types";
import { TrackingService } from "./tracking.service";
import { DEFAULT_TRACKING_COUNTRY } from "./tracking.types";

/** How far back the board reads. Older rows stay queryable per keyword. */
const BOARD_HISTORY_DAYS = 180;
/** Top of the search results is where taps happen. */
const VISIBLE_RANK = 10;

function utcDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function cutoffDay(days: number): string {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);
}

function cutoffDate(days: number): Date {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Keyword rows the board serves, grouped per (keyword, country). Everything is
 * derived from rows we already store: rank snapshots for position, daily score
 * snapshots for difficulty and the competitor list, the listing for metadata.
 */
export class TrackingBoardService {
	/**
	 * Everything the tracker view needs in one call: position, score, trend,
	 * the leader of each phrase, what moved since the previous run, the runs
	 * themselves, our own metadata changes and the terms our metadata targets
	 * without ranking. Three separate round-trips (positions, scores, history)
	 * could never be lined up per keyword on the client without guessing.
	 */
	static async getBoard(
		appId: string,
		workspaceId: string,
		options: { country?: string } = {},
	): Promise<TrackingBoard> {
		const tracked = await db
			.select({
				country: trackedKeywords.country,
				keyword: trackedKeywords.keyword,
			})
			.from(trackedKeywords)
			.where(eq(trackedKeywords.appId, appId));

		const countries = [
			...new Set(tracked.map((k) => k.country.toLowerCase())),
		].sort();
		const country = (
			options.country ??
			countries[0] ??
			DEFAULT_TRACKING_COUNTRY
		).toLowerCase();
		const keywords = tracked
			.filter((k) => k.country.toLowerCase() === country)
			.map((k) => k.keyword);

		const config = await TrackingService.getConfig(appId, workspaceId);
		const language = langFor(country);

		const [snapshots, scores, metadata, changes] = await Promise.all([
			db
				.select()
				.from(rankSnapshots)
				.where(
					and(
						eq(rankSnapshots.appId, appId),
						eq(rankSnapshots.country, country),
						gte(rankSnapshots.createdAt, cutoffDate(BOARD_HISTORY_DAYS)),
					),
				)
				.orderBy(asc(rankSnapshots.createdAt)),
			TrackingBoardService.readScores(workspaceId, country, keywords),
			TrackingBoardService.readMetadata(appId, language),
			TrackingBoardService.readChanges(appId),
		]);

		// ── Rank history per keyword, one point per measurement day ──────
		const rankByKeyword = new Map<string, Map<string, number | null>>();
		const platformByKeyword = new Map<string, string>();
		const runDays = new Set<string>();
		for (const row of snapshots) {
			const day = utcDay(row.createdAt);
			runDays.add(day);
			platformByKeyword.set(row.keyword, row.platform);
			const days = rankByKeyword.get(row.keyword) ?? new Map();
			// Two checks a day (00:00 and 12:00): the later one wins the day,
			// so a day carries the freshest measurement, not the first.
			days.set(day, row.position);
			rankByKeyword.set(row.keyword, days);
		}
		const orderedDays = [...runDays].sort();

		// Keywords that were measured but are no longer tracked still belong on
		// the board: dropping them would silently erase their history.
		const allKeywords = [
			...new Set([...keywords, ...rankByKeyword.keys()]),
		].sort();

		const rows: BoardKeyword[] = allKeywords.map((keyword) => {
			const days =
				rankByKeyword.get(keyword) ?? new Map<string, number | null>();
			const rankTrend: BoardRankPoint[] = [...days.entries()]
				.sort((a, b) => a[0].localeCompare(b[0]))
				.slice(-BOARD_TREND_POINTS)
				.map(([day, position]) => ({ day, position }));
			const measuredDays = [...days.keys()].sort();
			const latestDay = measuredDays.at(-1) ?? null;
			const previousDay = measuredDays.at(-2) ?? null;
			const position = latestDay ? (days.get(latestDay) ?? null) : null;
			const previousPosition = previousDay
				? (days.get(previousDay) ?? null)
				: null;
			const ranked = [...days.values()].filter((p): p is number => p !== null);

			const scoreDays = scores.get(keyword) ?? [];
			const latestScore = scoreDays.at(-1) ?? null;
			const previousScore = scoreDays.at(-2) ?? null;
			const payload = latestScore?.payload ?? null;

			const classification =
				(latestScore?.classification as KeywordClassification | undefined) ??
				null;
			const difficulty = latestScore?.difficulty ?? null;

			return {
				bestPosition: ranked.length ? Math.min(...ranked) : null,
				classification,
				country,
				delta:
					position !== null && previousPosition !== null
						? previousPosition - position
						: null,
				difficulty,
				difficultyDelta:
					latestScore && previousScore
						? latestScore.difficulty - previousScore.difficulty
						: null,
				difficultyLabel: payload?.difficultyLabel ?? null,
				keyword,
				leader: TrackingBoardService.leaderOf(payload),
				measuredAt: latestDay,
				metadataFields: TrackingBoardService.fieldsCarrying(keyword, metadata),
				opportunity: latestScore?.opportunity ?? null,
				pick:
					difficulty !== null &&
					difficulty <= MAX_PICK_DIFFICULTY &&
					classification !== null &&
					PICK_CLASSIFICATIONS.has(classification),
				platform: platformByKeyword.get(keyword) ?? "appstore",
				popularity: latestScore?.popularity ?? null,
				position,
				previousPosition,
				rankTrend,
				scoredAt: latestScore?.day ?? null,
				scoreTrend: scoreDays.slice(-BOARD_TREND_POINTS).map(
					(s): BoardScorePoint => ({
						day: s.day,
						difficulty: s.difficulty,
						popularity: s.popularity,
					}),
				),
			};
		});

		const { metadataGap, metadataUntracked } =
			TrackingBoardService.metadataView(rows, metadata, keywords);

		return {
			changes,
			countries: countries.length ? countries : [country],
			country,
			keywords: rows,
			language,
			metadataGap,
			metadataUntracked,
			movement: TrackingBoardService.movement(rows, orderedDays, scores),
			runs: TrackingBoardService.runs(rankByKeyword, orderedDays, scores),
			stats: TrackingBoardService.stats(rows, orderedDays, config),
		};
	}

	// ── Sources ──────────────────────────────────────────────────────

	/**
	 * Daily score history per keyword, oldest first. The full payload (tiers,
	 * competitors, download curve) is fetched only for the newest day of each
	 * keyword - carrying it for every day would make the board response tens of
	 * megabytes for a single app.
	 */
	private static async readScores(
		workspaceId: string,
		country: string,
		keywords: string[],
	) {
		const byKeyword = new Map<
			string,
			Array<{
				classification: string;
				day: string;
				difficulty: number;
				opportunity: number;
				payload: KeywordScore | null;
				popularity: number | null;
			}>
		>();
		if (!keywords.length) return byKeyword;

		const rows = await db
			.select({
				classification: keywordScoreSnapshots.classification,
				day: keywordScoreSnapshots.day,
				difficulty: keywordScoreSnapshots.difficulty,
				id: keywordScoreSnapshots.id,
				keyword: keywordScoreSnapshots.keyword,
				opportunity: keywordScoreSnapshots.opportunity,
				popularity: keywordScoreSnapshots.popularity,
			})
			.from(keywordScoreSnapshots)
			.where(
				and(
					eq(keywordScoreSnapshots.workspaceId, workspaceId),
					eq(keywordScoreSnapshots.country, country),
					inArray(keywordScoreSnapshots.keyword, keywords),
					gte(keywordScoreSnapshots.day, cutoffDay(BOARD_HISTORY_DAYS)),
				),
			)
			.orderBy(asc(keywordScoreSnapshots.day));

		for (const row of rows) {
			const list = byKeyword.get(row.keyword) ?? [];
			list.push({ ...row, payload: null });
			byKeyword.set(row.keyword, list);
		}

		const latestIds = rows
			.reduce((acc, row) => {
				acc.set(row.keyword, row.id);
				return acc;
			}, new Map<string, string>())
			.values();
		const ids = [...latestIds];
		if (!ids.length) return byKeyword;

		const payloads = await db
			.select({
				id: keywordScoreSnapshots.id,
				keyword: keywordScoreSnapshots.keyword,
				payload: keywordScoreSnapshots.payload,
			})
			.from(keywordScoreSnapshots)
			.where(inArray(keywordScoreSnapshots.id, ids));
		for (const row of payloads) {
			const list = byKeyword.get(row.keyword);
			const last = list?.at(-1);
			if (last) last.payload = row.payload;
		}
		return byKeyword;
	}

	/**
	 * The indexed text of the market's listing. Live text first: what the store
	 * serves is what ranks, and scoring a draft nobody can search for would
	 * report a gap the store has never seen.
	 */
	private static async readMetadata(appId: string, language: string) {
		const rows = await db
			.select({
				keywords: listings.keywords,
				language: listings.language,
				shortDesc: listings.shortDesc,
				source: listings.source,
				title: listings.title,
			})
			.from(listings)
			.where(eq(listings.appId, appId));

		const matches = rows.filter(
			(r) =>
				r.language.toLowerCase() === language.toLowerCase() ||
				r.language.toLowerCase().startsWith(`${language.toLowerCase()}-`),
		);
		const pool = matches.length ? matches : rows;
		return (
			pool.find((r) => r.source === "remote") ??
			pool[0] ?? {
				keywords: null,
				language,
				shortDesc: null,
				source: "remote",
				title: null,
			}
		);
	}

	private static async readChanges(appId: string): Promise<BoardChange[]> {
		const [history, events] = await Promise.all([
			HistoryService.getHistory(appId),
			AppEventsService.list(appId),
		]);
		const changes: BoardChange[] = [
			...history.map((h) => ({
				date: (h.publishedAt ?? h.createdAt).toISOString(),
				field: h.field,
				label: `${h.field} changed`,
				language: h.language,
				newValue: h.newValue,
				oldValue: h.oldValue,
				type: "listing_field",
			})),
			...events
				.filter((e) => CHART_EVENT_TYPES.has(e.type))
				.map((e) => ({
					date: e.occurredAt.toISOString(),
					field: e.type,
					label: e.label,
					language: "",
					newValue: null,
					oldValue: null,
					type: e.type,
				})),
		];
		return changes.sort((a, b) => b.date.localeCompare(a.date));
	}

	// ── Derived views ────────────────────────────────────────────────

	private static leaderOf(payload: KeywordScore | null): BoardLeader | null {
		const top = payload?.competitors?.[0];
		if (!top) return null;
		return {
			developer: top.developer,
			rating: top.rating ?? null,
			ratingsCount: top.ratingsCount ?? null,
			title: top.title,
		};
	}

	/** Which indexed fields already carry this term. */
	private static fieldsCarrying(
		keyword: string,
		metadata: {
			keywords: string | null;
			shortDesc: string | null;
			title: string | null;
		},
	): MetadataField[] {
		const term = keyword.trim().toLowerCase();
		if (!term) return [];
		const fields: MetadataField[] = [];
		if ((metadata.title ?? "").toLowerCase().includes(term)) {
			fields.push("title");
		}
		if ((metadata.shortDesc ?? "").toLowerCase().includes(term)) {
			fields.push("subtitle");
		}
		// The keyword field is a comma-separated list, so a term counts when it
		// is one of the entries or a phrase spelled across them.
		const field = (metadata.keywords ?? "").toLowerCase();
		if (
			field
				.split(",")
				.map((k) => k.trim())
				.some((k) => k === term) ||
			(term.includes(" ") && field.includes(term))
		) {
			fields.push("keywords");
		}
		return fields;
	}

	/**
	 * The two halves of "our metadata says one thing, the store says another":
	 * terms we target and do not rank for, and terms we target without
	 * measuring them at all.
	 */
	private static metadataView(
		rows: BoardKeyword[],
		metadata: { keywords: string | null },
		trackedNow: string[],
	): { metadataGap: BoardGap[]; metadataUntracked: string[] } {
		const metadataGap = rows
			.filter((r) => r.metadataFields.length && r.position === null)
			.map((r) => ({
				difficulty: r.difficulty,
				fields: r.metadataFields,
				keyword: r.keyword,
				popularity: r.popularity,
			}))
			.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

		const known = new Set(trackedNow.map((k) => k.toLowerCase()));
		const metadataUntracked = [
			...new Set(
				(metadata.keywords ?? "")
					.split(",")
					.map((k) => k.trim().toLowerCase())
					.filter((k) => k.length > 1 && !known.has(k)),
			),
		].sort();

		return { metadataGap, metadataUntracked };
	}

	/**
	 * What changed between the two most recent runs. Entering and leaving the
	 * scanned depth are their own kinds: turning "outside the top 50" into a
	 * number would invent a position nobody measured.
	 */
	private static movement(
		rows: BoardKeyword[],
		days: string[],
		scores: Map<string, Array<{ day: string; difficulty: number }>>,
	): BoardMove[] {
		const latest = days.at(-1);
		const previous = days.at(-2);
		if (!latest) return [];

		const moves: BoardMove[] = [];
		for (const row of rows) {
			const now = row.rankTrend.find((p) => p.day === latest);
			if (!now) continue;
			const before = previous
				? row.rankTrend.find((p) => p.day === previous)
				: undefined;
			const scoreDays = scores.get(row.keyword) ?? [];
			const difficultyDelta =
				scoreDays.length > 1
					? (scoreDays.at(-1)?.difficulty ?? 0) -
						(scoreDays.at(-2)?.difficulty ?? 0)
					: null;

			if (!before) {
				if (now.position === null) continue;
				moves.push({
					country: row.country,
					difficultyDelta,
					from: null,
					keyword: row.keyword,
					kind: "new",
					to: now.position,
				});
				continue;
			}
			if (before.position === null && now.position === null) continue;
			if (before.position === null) {
				moves.push({
					country: row.country,
					difficultyDelta,
					from: null,
					keyword: row.keyword,
					kind: "entered",
					to: now.position,
				});
				continue;
			}
			if (now.position === null) {
				moves.push({
					country: row.country,
					difficultyDelta,
					from: before.position,
					keyword: row.keyword,
					kind: "dropped",
					to: null,
				});
				continue;
			}
			if (before.position !== now.position) {
				moves.push({
					country: row.country,
					difficultyDelta,
					from: before.position,
					keyword: row.keyword,
					kind: "moved",
					to: now.position,
				});
			}
		}
		// Biggest real movement first; entries and exits lead, they are events.
		return moves.sort((a, b) => {
			const weight = (m: BoardMove) =>
				m.kind === "moved" ? Math.abs((m.from ?? 0) - (m.to ?? 0)) : 1000;
			return weight(b) - weight(a);
		});
	}

	private static runs(
		rankByKeyword: Map<string, Map<string, number | null>>,
		days: string[],
		scores: Map<string, Array<{ day: string; difficulty: number }>>,
	): BoardRun[] {
		return days
			.map((day) => {
				let measured = 0;
				let ranked = 0;
				let top10 = 0;
				for (const byDay of rankByKeyword.values()) {
					if (!byDay.has(day)) continue;
					measured++;
					const position = byDay.get(day) ?? null;
					if (position === null) continue;
					ranked++;
					if (position <= VISIBLE_RANK) top10++;
				}
				const difficulties = [...scores.values()]
					.map((list) => list.find((s) => s.day === day)?.difficulty)
					.filter((d): d is number => d !== undefined);
				return {
					avgDifficulty: difficulties.length
						? Math.round(
								difficulties.reduce((sum, d) => sum + d, 0) /
									difficulties.length,
							)
						: null,
					day,
					measured,
					ranked,
					top10,
				};
			})
			.reverse();
	}

	private static stats(
		rows: BoardKeyword[],
		days: string[],
		config: { lastRankCheckAt: Date | null } | undefined,
	): BoardStats {
		const ranked = rows.filter(
			(r): r is BoardKeyword & { position: number } => r.position !== null,
		);
		const scored = rows.filter((r) => r.scoredAt);
		const lastScoredAt = scored
			.map((r) => r.scoredAt as string)
			.sort()
			.at(-1);
		return {
			avgPosition: ranked.length
				? Math.round(
						(ranked.reduce((sum, r) => sum + r.position, 0) / ranked.length) *
							10,
					) / 10
				: null,
			bestPosition: ranked.length
				? Math.min(...ranked.map((r) => r.position))
				: null,
			declined: rows.filter((r) => (r.delta ?? 0) < 0).length,
			improved: rows.filter((r) => (r.delta ?? 0) > 0).length,
			lastCheckedAt: config?.lastRankCheckAt?.toISOString() ?? null,
			lastScoredAt: lastScoredAt ?? null,
			picks: rows.filter((r) => r.pick).length,
			ranked: ranked.length,
			runs: days.length,
			top10: ranked.filter((r) => r.position <= VISIBLE_RANK).length,
			tracked: rows.length,
		};
	}
}

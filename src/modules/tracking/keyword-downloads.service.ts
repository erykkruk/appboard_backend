import { and, desc, eq, inArray } from "drizzle-orm";
import {
	type DownloadRange,
	estimatedDailyDownloadsAt,
} from "@/modules/research/download-estimate";
import type { DownloadEstimates } from "@/modules/research/scoring-types";
import { isSearchTermPlaceholder } from "@/modules/store-performance/play-reports.aggregate";
import { StorePerformanceService } from "@/modules/store-performance/store-performance.service";
import type {
	MonthReport,
	SearchTermRow,
} from "@/modules/store-performance/store-performance.types";
import { db } from "@/utils/db";
import {
	apps,
	keywordScoreSnapshots,
	rankSnapshots,
	stores,
	trackedKeywords,
} from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import {
	ESTIMATE_DAYS_PER_MONTH,
	type EstimatedDownloadsSummary,
	type EstimatedKeywordDownloads,
	type KeywordDownloadsReport,
	type KeywordDownloadsRow,
	PLAY_SEARCH_TERM_SCOPE,
	type PlayDownloadsSummary,
	type PlayKeywordDownloads,
	type PlayMonthTotals,
	type PlaySearchFunnel,
} from "./keyword-downloads.types";
import { rankTrackingSupport } from "./rank-support";
import { DEFAULT_TRACKING_COUNTRY } from "./tracking.types";

const IOS_PLATFORM = "ios";
const ANDROID_PLATFORM = "android";
/** The traffic source Play gives installs that came from typing a query. */
const PLAY_SEARCH_SOURCE = "google play search";
/** Month to date + the latest full month. */
const PLAY_REPORT_MONTHS = 2;

const UNSUPPORTED_PLATFORM_MESSAGE =
	"Downloads per keyword are available for App Store apps (estimate) and Google Play apps (Play Console report).";

/**
 * Letters Unicode does not decompose into base letter + accent ("ł" has no
 * NFD form), folded by hand so "glowka" and "główka" are one search term.
 */
const UNDECOMPOSABLE_LETTERS: Record<string, string> = {
	ß: "ss",
	æ: "ae",
	ø: "o",
	đ: "d",
	ı: "i",
	ł: "l",
	œ: "oe",
};
const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE_RUN = /\s+/g;

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Comparable form of a keyword or a Play search term: lowercased, accents
 * dropped, whitespace collapsed. Play lowercases terms itself but keeps
 * whatever accents and spacing the user typed.
 */
export function normalizeSearchTerm(term: string): string {
	return term
		.normalize("NFKD")
		.replace(COMBINING_MARKS, "")
		.toLowerCase()
		.replace(/[æđıłøœß]/g, (letter) => UNDECOMPOSABLE_LETTERS[letter] ?? letter)
		.replace(WHITESPACE_RUN, " ")
		.trim();
}

interface TermTotal extends PlaySearchFunnel {
	terms: string[];
}

/** Play search terms of one month keyed by normalized form; variants that fold together are summed. */
export function playTermIndex(
	searchTerms: readonly SearchTermRow[],
): Map<string, TermTotal> {
	const index = new Map<string, TermTotal>();
	for (const row of searchTerms) {
		if (isSearchTermPlaceholder(row.term)) continue;
		const key = normalizeSearchTerm(row.term);
		if (!key) continue;
		const total = index.get(key) ?? { acquisitions: 0, terms: [], visitors: 0 };
		total.acquisitions += row.acquisitions;
		total.visitors += row.visitors;
		total.terms.push(row.term);
		index.set(key, total);
	}
	return index;
}

function monthTotals(month: MonthReport | undefined): PlayMonthTotals | null {
	if (!month) return null;
	const search = month.traffic?.sources.find(
		(s) => s.source.trim().toLowerCase() === PLAY_SEARCH_SOURCE,
	);
	return {
		available: month.traffic !== null,
		lastDay: month.lastDay,
		month: month.month,
		searchInstalls: month.traffic ? (search?.acquisitions ?? 0) : null,
		searchVisitors: month.traffic ? (search?.visitors ?? 0) : null,
	};
}

/** Real Play numbers for each keyword: the latest full month and the month to date. */
export function matchPlayKeywords(
	keywords: readonly string[],
	months: { current: MonthReport | undefined; latest: MonthReport | undefined },
): Map<string, PlayKeywordDownloads> {
	const current = playTermIndex(months.current?.traffic?.searchTerms ?? []);
	const latest = playTermIndex(months.latest?.traffic?.searchTerms ?? []);
	const funnelOf = (total: TermTotal | undefined): PlaySearchFunnel | null =>
		total
			? { acquisitions: total.acquisitions, visitors: total.visitors }
			: null;

	const out = new Map<string, PlayKeywordDownloads>();
	for (const keyword of keywords) {
		const key = normalizeSearchTerm(keyword);
		const now = current.get(key);
		const before = latest.get(key);
		out.set(keyword, {
			currentMonth: funnelOf(now),
			latestMonth: funnelOf(before),
			terms: [...new Set([...(before?.terms ?? []), ...(now?.terms ?? [])])],
		});
	}
	return out;
}

/** The latest keyword score of one market, as far as the estimate needs it. */
export interface ScoreCurve {
	day: string;
	downloads: DownloadEstimates | null;
	popularity: number | null;
}

/** The App Store estimate at the keyword's current rank, per day and per month. */
export function estimateAtRank(
	score: ScoreCurve | null,
	position: number | null,
): EstimatedKeywordDownloads | null {
	if (!score || position === null) return null;
	const perDay = estimatedDailyDownloadsAt(score.downloads, position);
	if (!perDay || !score.downloads) return null;
	return {
		beyondModel: position > score.downloads.positions.length,
		perDay,
		perMonth: perMonth(perDay),
		popularity: score.popularity,
		position,
		scoredAt: score.day,
	};
}

function perMonth(range: DownloadRange): DownloadRange {
	return {
		high: round2(range.high * ESTIMATE_DAYS_PER_MONTH),
		low: round2(range.low * ESTIMATE_DAYS_PER_MONTH),
	};
}

export function summarizeEstimates(
	rows: readonly KeywordDownloadsRow[],
	scored: number,
): EstimatedDownloadsSummary {
	let low = 0;
	let high = 0;
	let ranked = 0;
	for (const row of rows) {
		if (!row.estimate) continue;
		ranked += 1;
		low += row.estimate.perDay.low;
		high += row.estimate.perDay.high;
	}
	const perDay = { high: round2(high), low: round2(low) };
	return {
		daysPerMonth: ESTIMATE_DAYS_PER_MONTH,
		perDay,
		perMonth: perMonth(perDay),
		ranked,
		scored,
	};
}

/**
 * How many downloads each tracked keyword of one market brings. Google Play:
 * real installs per search term from the Play Console bulk report (read
 * through the Store performance service and its cache). App Store: the download estimate of the
 * keyword score at the current rank, the same model as the keyword score
 * summary. Apple publishes no per-keyword downloads.
 */
export class KeywordDownloadsService {
	static async forMarket(
		appId: string,
		workspaceId: string,
		options: { country?: string } = {},
	): Promise<KeywordDownloadsReport> {
		const [app] = await db
			.select({ devices: apps.devices, platform: apps.platform })
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(and(eq(apps.id, appId), eq(stores.workspaceId, workspaceId)))
			.limit(1);
		if (!app) buildError("notFound", { info: "App not found" });

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
		const keywords = [
			...new Set(
				tracked
					.filter((k) => k.country.toLowerCase() === country)
					.map((k) => k.keyword),
			),
		].sort();

		const base = {
			country,
			estimate: null,
			message: null,
			platform: app.platform,
			play: null,
		};

		if (app.platform === IOS_PLATFORM) {
			const support = rankTrackingSupport(app);
			if (!support.supported) {
				return {
					...base,
					keywords: keywords.map((keyword) => ({
						estimate: null,
						keyword,
						play: null,
					})),
					message: support.note,
					source: "unsupported",
				};
			}
			return KeywordDownloadsService.appStoreEstimate(
				appId,
				workspaceId,
				country,
				keywords,
				base,
			);
		}
		if (app.platform === ANDROID_PLATFORM) {
			return KeywordDownloadsService.playReport(
				appId,
				workspaceId,
				keywords,
				base,
			);
		}
		return {
			...base,
			keywords: keywords.map((keyword) => ({
				estimate: null,
				keyword,
				play: null,
			})),
			message: UNSUPPORTED_PLATFORM_MESSAGE,
			source: "unsupported",
		};
	}

	private static async appStoreEstimate(
		appId: string,
		workspaceId: string,
		country: string,
		keywords: string[],
		base: Omit<KeywordDownloadsReport, "keywords" | "source">,
	): Promise<KeywordDownloadsReport> {
		const [positions, scores] = await Promise.all([
			KeywordDownloadsService.latestPositions(appId, country, keywords),
			KeywordDownloadsService.latestScores(workspaceId, country, keywords),
		]);
		const rows: KeywordDownloadsRow[] = keywords.map((keyword) => ({
			estimate: estimateAtRank(
				scores.get(keyword) ?? null,
				positions.get(keyword) ?? null,
			),
			keyword,
			play: null,
		}));
		return {
			...base,
			estimate: summarizeEstimates(rows, scores.size),
			keywords: rows,
			source: "app_store_estimate",
		};
	}

	private static async playReport(
		appId: string,
		workspaceId: string,
		keywords: string[],
		base: Omit<KeywordDownloadsReport, "keywords" | "source">,
	): Promise<KeywordDownloadsReport> {
		const empty = keywords.map(
			(keyword): KeywordDownloadsRow => ({
				estimate: null,
				keyword,
				play: null,
			}),
		);
		// Two months are all the table shows: the month to date and the one
		// before it. The report is cached for 6 h per window, so a board that is
		// opened again reads no bucket.
		const report = await StorePerformanceService.report(appId, workspaceId, {
			months: PLAY_REPORT_MONTHS,
		});
		if (!report.supported) {
			return {
				...base,
				keywords: empty,
				message: report.message,
				source: "unsupported",
			};
		}

		const [current, latest] = report.months;
		const play: PlayDownloadsSummary = {
			currentMonth: monthTotals(current),
			fetchedAt: report.fetchedAt,
			latestMonth: monthTotals(latest),
			message: report.message,
			scope: PLAY_SEARCH_TERM_SCOPE,
			status: report.status,
			tvOnly: report.tvOnly,
		};
		if (report.status !== "ok") {
			return {
				...base,
				keywords: empty,
				play,
				source: "google_play_report",
			};
		}

		const matched = matchPlayKeywords(keywords, { current, latest });
		return {
			...base,
			keywords: keywords.map((keyword) => ({
				estimate: null,
				keyword,
				play: matched.get(keyword) ?? null,
			})),
			play,
			source: "google_play_report",
		};
	}

	/** Position of the newest rank check per keyword of one market (NULL = outside the scan). */
	private static async latestPositions(
		appId: string,
		country: string,
		keywords: string[],
	): Promise<Map<string, number | null>> {
		if (!keywords.length) return new Map();
		const rows = await db
			.selectDistinctOn([rankSnapshots.keyword], {
				keyword: rankSnapshots.keyword,
				position: rankSnapshots.position,
			})
			.from(rankSnapshots)
			.where(
				and(
					eq(rankSnapshots.appId, appId),
					eq(rankSnapshots.country, country),
					inArray(rankSnapshots.keyword, keywords),
				),
			)
			.orderBy(rankSnapshots.keyword, desc(rankSnapshots.createdAt));
		return new Map(rows.map((row) => [row.keyword, row.position]));
	}

	/** Newest keyword score per keyword of one market, workspace-scoped. */
	private static async latestScores(
		workspaceId: string,
		country: string,
		keywords: string[],
	) {
		const out = new Map<string, ScoreCurve>();
		if (!keywords.length) return out;
		const rows = await db
			.selectDistinctOn([keywordScoreSnapshots.keyword], {
				day: keywordScoreSnapshots.day,
				keyword: keywordScoreSnapshots.keyword,
				payload: keywordScoreSnapshots.payload,
				popularity: keywordScoreSnapshots.popularity,
			})
			.from(keywordScoreSnapshots)
			.where(
				and(
					eq(keywordScoreSnapshots.workspaceId, workspaceId),
					eq(keywordScoreSnapshots.country, country),
					inArray(keywordScoreSnapshots.keyword, keywords),
				),
			)
			.orderBy(keywordScoreSnapshots.keyword, desc(keywordScoreSnapshots.day));
		for (const row of rows) {
			out.set(row.keyword, {
				day: row.day,
				downloads: row.payload?.downloads ?? null,
				popularity: row.popularity,
			});
		}
		return out;
	}
}

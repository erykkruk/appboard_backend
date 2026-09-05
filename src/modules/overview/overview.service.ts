import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Platform, StoreConnectionMode } from "@/config/const";
import type { StoreFacts } from "@/providers/store-provider";
import { db } from "@/utils/db";
import {
	appAudits,
	apps,
	rankSnapshots,
	reviews,
	stores,
	trackedKeywords,
} from "@/utils/db/schema";

const AUDIT_STATUS_READY = "ready";
const TOP_POSITION_THRESHOLD = 10;
const AVG_POSITION_DECIMALS = 1;

export interface OverviewAppRow {
	auditScore: number | null;
	avgPosition: number | null;
	connectionMode: StoreConnectionMode;
	draftScore: number | null;
	iconUrl: string | null;
	id: string;
	lastSyncedAt: string | null;
	name: string;
	platform: Platform;
	reviewsTotal: number;
	reviewsUnanswered: number;
	storeRating: number | null;
	storeRatingsCount: number | null;
	top10Count: number;
	trackedKeywords: number;
}

export interface OverviewTotals {
	apps: number;
	/**
	 * Always false today: no store sales/analytics API is wired (App Store
	 * Connect sales reports, Play Console stats), so the panel must not
	 * promise a downloads column until one exists.
	 */
	downloadsAvailable: false;
	reviewsUnanswered: number;
	trackedKeywords: number;
}

export interface OverviewResponse {
	apps: OverviewAppRow[];
	totals: OverviewTotals;
}

type AppRawData = { publicCountry?: string; storeFacts?: StoreFacts } | null;

interface ReviewStats {
	total: number;
	unanswered: number;
}

interface AuditScores {
	draftScore: number | null;
	storeScore: number;
}

interface RankStats {
	avgPosition: number | null;
	top10Count: number;
}

function emptyTotals(): OverviewTotals {
	return {
		apps: 0,
		downloadsAvailable: false,
		reviewsUnanswered: 0,
		trackedKeywords: 0,
	};
}

function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundTo(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

export class OverviewService {
	/**
	 * One row per app in the workspace with the numbers the dashboard shows
	 * side by side. Every aggregate is a single grouped query over the
	 * workspace's app ids, so the cost stays flat as apps are added.
	 */
	static async get(workspaceId: string): Promise<OverviewResponse> {
		const appRows = await db
			.select({
				connectionMode: stores.connectionMode,
				iconUrl: apps.iconUrl,
				id: apps.id,
				lastSyncedAt: apps.lastSyncedAt,
				name: apps.name,
				platform: apps.platform,
				rawData: apps.rawData,
			})
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(eq(stores.workspaceId, workspaceId))
			.orderBy(asc(apps.name));

		if (appRows.length === 0) {
			return { apps: [], totals: emptyTotals() };
		}

		const appIds = appRows.map((row) => row.id);
		const [reviewStats, auditScores, keywordCounts, rankStats] =
			await Promise.all([
				OverviewService.reviewStatsByApp(appIds),
				OverviewService.readyAuditByApp(appIds),
				OverviewService.trackedKeywordCountByApp(appIds),
				OverviewService.rankStatsByApp(appIds),
			]);

		const rows: OverviewAppRow[] = appRows.map((row) => {
			const facts = (row.rawData as AppRawData)?.storeFacts;
			const reviewsForApp = reviewStats.get(row.id);
			const audit = auditScores.get(row.id);
			const ranks = rankStats.get(row.id);
			return {
				auditScore: audit?.storeScore ?? null,
				avgPosition: ranks?.avgPosition ?? null,
				connectionMode: row.connectionMode as StoreConnectionMode,
				draftScore: audit?.draftScore ?? null,
				iconUrl: row.iconUrl ?? null,
				id: row.id,
				lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
				name: row.name,
				platform: row.platform as Platform,
				reviewsTotal: reviewsForApp?.total ?? 0,
				reviewsUnanswered: reviewsForApp?.unanswered ?? 0,
				storeRating: numberOrNull(facts?.rating),
				storeRatingsCount: numberOrNull(facts?.ratingsCount),
				top10Count: ranks?.top10Count ?? 0,
				trackedKeywords: keywordCounts.get(row.id) ?? 0,
			};
		});

		const totals: OverviewTotals = {
			apps: rows.length,
			downloadsAvailable: false,
			reviewsUnanswered: rows.reduce((sum, r) => sum + r.reviewsUnanswered, 0),
			trackedKeywords: rows.reduce((sum, r) => sum + r.trackedKeywords, 0),
		};

		return { apps: rows, totals };
	}

	private static async reviewStatsByApp(
		appIds: string[],
	): Promise<Map<string, ReviewStats>> {
		const rows = await db
			.select({
				appId: reviews.appId,
				total: sql<number>`count(*)::int`,
				unanswered: sql<number>`count(*) filter (where ${reviews.replyText} is null)::int`,
			})
			.from(reviews)
			.where(inArray(reviews.appId, appIds))
			.groupBy(reviews.appId);
		return new Map(
			rows.map((r) => [r.appId, { total: r.total, unanswered: r.unanswered }]),
		);
	}

	/**
	 * Audits are stored per (app, country); the dashboard shows one score per
	 * app, so the most recently refreshed ready row wins.
	 */
	private static async readyAuditByApp(
		appIds: string[],
	): Promise<Map<string, AuditScores>> {
		const rows = await db
			.selectDistinctOn([appAudits.appId], {
				appId: appAudits.appId,
				draftScore: appAudits.draftScore,
				storeScore: appAudits.storeScore,
			})
			.from(appAudits)
			.where(
				and(
					inArray(appAudits.appId, appIds),
					eq(appAudits.status, AUDIT_STATUS_READY),
				),
			)
			.orderBy(appAudits.appId, desc(appAudits.updatedAt));
		return new Map(
			rows.map((r) => [
				r.appId,
				{ draftScore: r.draftScore, storeScore: r.storeScore },
			]),
		);
	}

	private static async trackedKeywordCountByApp(
		appIds: string[],
	): Promise<Map<string, number>> {
		const rows = await db
			.select({
				appId: trackedKeywords.appId,
				count: sql<number>`count(*)::int`,
			})
			.from(trackedKeywords)
			.where(inArray(trackedKeywords.appId, appIds))
			.groupBy(trackedKeywords.appId);
		return new Map(rows.map((r) => [r.appId, r.count]));
	}

	/**
	 * Latest snapshot per tracked (app, country, keyword), then averaged per
	 * app. Snapshots for keywords that are no longer tracked are ignored so a
	 * removed keyword stops dragging the average. `avg` skips NULL positions
	 * (not in the top 50) by itself.
	 */
	private static async rankStatsByApp(
		appIds: string[],
	): Promise<Map<string, RankStats>> {
		const latest = db
			.selectDistinctOn(
				[rankSnapshots.appId, rankSnapshots.country, rankSnapshots.keyword],
				{
					appId: rankSnapshots.appId,
					position: rankSnapshots.position,
				},
			)
			.from(rankSnapshots)
			.innerJoin(
				trackedKeywords,
				and(
					eq(trackedKeywords.appId, rankSnapshots.appId),
					eq(trackedKeywords.country, rankSnapshots.country),
					eq(trackedKeywords.keyword, rankSnapshots.keyword),
				),
			)
			.where(inArray(rankSnapshots.appId, appIds))
			.orderBy(
				rankSnapshots.appId,
				rankSnapshots.country,
				rankSnapshots.keyword,
				desc(rankSnapshots.createdAt),
				desc(rankSnapshots.id),
			)
			.as("latest");

		const rows = await db
			.select({
				appId: latest.appId,
				avgPosition: sql<number | null>`avg(${latest.position})::float`,
				top10Count: sql<number>`count(*) filter (where ${latest.position} <= ${TOP_POSITION_THRESHOLD})::int`,
			})
			.from(latest)
			.groupBy(latest.appId);

		return new Map(
			rows.map((r) => [
				r.appId,
				{
					avgPosition:
						r.avgPosition === null
							? null
							: roundTo(Number(r.avgPosition), AVG_POSITION_DECIMALS),
					top10Count: r.top10Count,
				},
			]),
		);
	}
}

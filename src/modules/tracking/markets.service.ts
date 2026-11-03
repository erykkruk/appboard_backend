import { asc, eq, lte, sql } from "drizzle-orm";
import { AppsService } from "@/modules/apps/apps.service";
import { db } from "@/utils/db";
import { rankSnapshots, trackedKeywords } from "@/utils/db/schema";
import { RankCheckJobs } from "./rank-check.jobs";
import { rankTrackingSupport } from "./rank-support";
import type {
	TrackingMarket,
	TrackingMarketsOverview,
	TrackingMarketTotals,
} from "./tracking.types";

/** Top of the search results is where taps happen. */
const TOP_VISIBLE = 10;
/** The scan depth of both store searches. */
const TOP_SCANNED = 50;
/** Latest + previous measurement per keyword is all the overview compares. */
const MEASUREMENTS_PER_KEYWORD = 2;

interface Measurement {
	createdAt: Date;
	position: number | null;
}

function median(values: number[]): number | null {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[mid]
		: Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

function average(values: number[]): number | null {
	if (!values.length) return null;
	return (
		Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) /
		10
	);
}

/** Aggregate one market (or all of them) from latest/previous measurements. */
function aggregate(
	tracked: string[],
	measurements: Map<string, Measurement[]>,
	failedKeywords: Set<string>,
): Omit<TrackingMarket, "country"> {
	const positions: number[] = [];
	let measured = 0;
	let improved = 0;
	let declined = 0;
	let entered = 0;
	let dropped = 0;
	let lastCheckedAt: Date | null = null;

	for (const keyword of tracked) {
		const list = measurements.get(keyword);
		const latest = list?.[0];
		if (!latest) continue;
		measured++;
		if (!lastCheckedAt || latest.createdAt > lastCheckedAt) {
			lastCheckedAt = latest.createdAt;
		}
		if (latest.position !== null) positions.push(latest.position);

		const previous = list?.[1];
		if (!previous) continue;
		if (latest.position !== null && previous.position !== null) {
			if (latest.position < previous.position) improved++;
			else if (latest.position > previous.position) declined++;
		} else if (latest.position !== null) {
			entered++;
		} else if (previous.position !== null) {
			dropped++;
		}
	}

	return {
		avgPosition: average(positions),
		bestPosition: positions.length ? Math.min(...positions) : null,
		declined,
		dropped,
		entered,
		failedLastRun: tracked.filter((k) => failedKeywords.has(k)).length,
		improved,
		lastCheckedAt,
		measured,
		medianPosition: median(positions),
		ranked: positions.length,
		top10: positions.filter((p) => p <= TOP_VISIBLE).length,
		top50: positions.filter((p) => p <= TOP_SCANNED).length,
		tracked: tracked.length,
	};
}

/**
 * Every market of an app on one screen: per country how many tracked
 * keywords rank, how many are on the first page, median and average position
 * and what moved since each keyword's previous measurement. The per-country
 * board (`TrackingBoardService.getBoard`) is the drill-down.
 */
export class TrackingMarketsService {
	static async getMarkets(
		appId: string,
		workspaceId: string,
	): Promise<TrackingMarketsOverview> {
		const app = await AppsService.findOne(workspaceId, appId);
		const support = rankTrackingSupport(app);

		const tracked = await db
			.select({
				country: trackedKeywords.country,
				keyword: trackedKeywords.keyword,
			})
			.from(trackedKeywords)
			.where(eq(trackedKeywords.appId, appId))
			.orderBy(asc(trackedKeywords.country), asc(trackedKeywords.keyword));

		// Two newest measurements per (country, keyword), ranked in the DB:
		// reading every snapshot of 700 keywords x months would be wasteful.
		const ranked = db
			.select({
				country: rankSnapshots.country,
				createdAt: rankSnapshots.createdAt,
				keyword: rankSnapshots.keyword,
				position: rankSnapshots.position,
				rn: sql<number>`row_number() over (partition by ${rankSnapshots.country}, ${rankSnapshots.keyword} order by ${rankSnapshots.createdAt} desc)`.as(
					"rn",
				),
			})
			.from(rankSnapshots)
			.where(eq(rankSnapshots.appId, appId))
			.as("ranked");
		const rows = await db
			.select()
			.from(ranked)
			.where(lte(ranked.rn, MEASUREMENTS_PER_KEYWORD))
			.orderBy(asc(ranked.country), asc(ranked.keyword), asc(ranked.rn));

		const byCountry = new Map<string, Map<string, Measurement[]>>();
		for (const row of rows) {
			const keywords = byCountry.get(row.country) ?? new Map();
			const list = keywords.get(row.keyword) ?? [];
			list.push({ createdAt: row.createdAt, position: row.position });
			keywords.set(row.keyword, list);
			byCountry.set(row.country, keywords);
		}

		const lastRun = await RankCheckJobs.latest(appId, workspaceId);
		const failedByCountry = new Map<string, Set<string>>();
		for (const failure of lastRun?.failures ?? []) {
			const set = failedByCountry.get(failure.country) ?? new Set<string>();
			set.add(failure.keyword);
			failedByCountry.set(failure.country, set);
		}

		const trackedByCountry = new Map<string, string[]>();
		for (const row of tracked) {
			trackedByCountry.set(row.country, [
				...(trackedByCountry.get(row.country) ?? []),
				row.keyword,
			]);
		}

		const markets: TrackingMarket[] = [...trackedByCountry.entries()].map(
			([country, keywords]) => ({
				country,
				...aggregate(
					keywords,
					byCountry.get(country) ?? new Map(),
					failedByCountry.get(country) ?? new Set(),
				),
			}),
		);

		// Totals over every keyword of every market, not an average of averages.
		const allMeasurements = new Map<string, Measurement[]>();
		const allFailed = new Set<string>();
		const allTracked: string[] = [];
		for (const [country, keywords] of trackedByCountry) {
			for (const keyword of keywords) {
				const key = `${country}|${keyword}`;
				allTracked.push(key);
				const list = byCountry.get(country)?.get(keyword);
				if (list) allMeasurements.set(key, list);
				if (failedByCountry.get(country)?.has(keyword)) allFailed.add(key);
			}
		}
		const totals: TrackingMarketTotals = {
			...aggregate(allTracked, allMeasurements, allFailed),
			markets: markets.length,
		};

		return {
			app: {
				devices: support.devices,
				externalId: app.externalId,
				id: app.id,
				name: app.name,
				platform: app.platform,
			},
			lastRun,
			markets,
			rankTracking: support,
			totals,
		};
	}
}

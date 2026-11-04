import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	lt,
	type SQL,
	sql,
} from "drizzle-orm";
import config from "@/config";
import { AppsService } from "@/modules/apps/apps.service";
import { isBrandKeyword } from "@/modules/research/listing-audit";
import { db } from "@/utils/db";
import { rankSnapshots, trackedKeywords } from "@/utils/db/schema";
import { localDayNumber } from "./scheduler.service";
import {
	DEFAULT_SCHEDULER_TZ,
	MARKET_HISTORY_DEFAULT_DAYS,
	MARKET_HISTORY_MAX_DAYS,
	type TrackingMarketHistory,
	type TrackingMarketsHistory,
} from "./tracking.types";

/** Top of the search results is where taps happen (same cut as the table). */
const TOP_VISIBLE = 10;
/** The scan depth of both store searches. */
const TOP_SCANNED = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface MarketsHistoryOptions {
	days?: number;
	/** Injected in tests; the window ends on the local day of `now`. */
	now?: Date;
}

function dayString(dayNumber: number): string {
	return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

/** Same rounding as the markets table median. */
function roundMedian(value: number | string | null): number | null {
	if (value === null) return null;
	return Math.round(Number(value) * 10) / 10;
}

function clampDays(days: number | undefined): number {
	if (!days || !Number.isFinite(days)) return MARKET_HISTORY_DEFAULT_DAYS;
	return Math.min(MARKET_HISTORY_MAX_DAYS, Math.max(1, Math.floor(days)));
}

/**
 * Day-by-day history of the markets table, for its sparklines.
 *
 * The value of a day is what the table would have shown at the end of that
 * day: every tracked keyword at its LAST measurement on or before the day
 * (two checks a day: the later one wins; a keyword the run had not reached
 * yet keeps its previous position, exactly like the live table). Only
 * currently tracked keywords count - a removed keyword has no record of when
 * it was tracked - and a keyword counts from the day it was added or first
 * measured, whichever came first (imported history predates `createdAt`).
 * Days without a single measurement in a market are left out, so a chart
 * shows a gap instead of a flat line nobody measured.
 *
 * One grouped query: the keywords of each market are laid over the market's
 * measured days, the position is carried forward with a running count, and
 * everything is aggregated per (country, day) in Postgres.
 */
export class TrackingMarketsHistoryService {
	static async getHistory(
		appId: string,
		workspaceId: string,
		options: MarketsHistoryOptions = {},
	): Promise<TrackingMarketsHistory> {
		const app = await AppsService.findOne(workspaceId, appId);
		const timeZone = config.SCHEDULER_TZ || DEFAULT_SCHEDULER_TZ;
		const days = clampDays(options.days);
		const today = localDayNumber(options.now ?? new Date(), timeZone);
		const from = dayString(today - days + 1);
		const to = dayString(today);

		const tracked = await db
			.selectDistinct({
				country: trackedKeywords.country,
				keyword: trackedKeywords.keyword,
			})
			.from(trackedKeywords)
			.where(eq(trackedKeywords.appId, appId))
			.orderBy(asc(trackedKeywords.country));
		const countries = [...new Set(tracked.map((row) => row.country))];
		if (!countries.length) return { from, markets: [], timeZone, to };

		// Decided in TypeScript so the history can never disagree with the
		// table about what counts as the app's own name.
		const brandKeywords = [
			...new Set(
				tracked
					.map((row) => row.keyword)
					.filter((keyword) => isBrandKeyword(keyword, app.name)),
			),
		];
		const isBrand: SQL = brandKeywords.length
			? inArray(trackedKeywords.keyword, brandKeywords)
			: sql`false`;

		const localDay = (
			column: typeof rankSnapshots.createdAt | typeof trackedKeywords.createdAt,
		) => sql`((${column} at time zone 'UTC') at time zone ${timeZone})::date`;
		// Local midnight that opens the window, as the UTC timestamp we store.
		const windowStart = sql`((${from}::date)::timestamp at time zone ${timeZone}) at time zone 'UTC'`;

		// Drizzle renders aliased fields of a CTE without their table name, so
		// every alias below is unique across the whole query.
		const tk = db.$with("tk").as(
			db
				.select({
					addedDay: sql<string>`${localDay(trackedKeywords.createdAt)}`.as(
						"tk_added_day",
					),
					brand: sql<boolean>`${isBrand}`.as("tk_brand"),
					country: trackedKeywords.country,
					keyword: trackedKeywords.keyword,
				})
				.from(trackedKeywords)
				.where(eq(trackedKeywords.appId, appId)),
		);

		const inWindow = db
			.select({
				country: rankSnapshots.country,
				createdAt: rankSnapshots.createdAt,
				day: sql<string>`${localDay(rankSnapshots.createdAt)}`.as(
					"snapshot_day",
				),
				keyword: rankSnapshots.keyword,
				position: rankSnapshots.position,
			})
			.from(rankSnapshots)
			.innerJoin(
				tk,
				and(
					eq(tk.country, rankSnapshots.country),
					eq(tk.keyword, rankSnapshots.keyword),
				),
			)
			.where(
				and(
					eq(rankSnapshots.appId, appId),
					gte(rankSnapshots.createdAt, windowStart),
				),
			)
			.as("in_window");

		// Last measurement of each keyword per local day inside the window.
		const recent = db.$with("recent").as(
			db
				.selectDistinctOn([inWindow.country, inWindow.keyword, inWindow.day], {
					country: inWindow.country,
					day: inWindow.day,
					keyword: inWindow.keyword,
					position: inWindow.position,
				})
				.from(inWindow)
				.orderBy(
					inWindow.country,
					inWindow.keyword,
					inWindow.day,
					desc(inWindow.createdAt),
				),
		);

		// Where each keyword stood when the window opened (index-backed probe).
		const before = db
			.select({ position: rankSnapshots.position })
			.from(rankSnapshots)
			.where(
				and(
					eq(rankSnapshots.appId, appId),
					eq(rankSnapshots.country, tk.country),
					eq(rankSnapshots.keyword, tk.keyword),
					lt(rankSnapshots.createdAt, windowStart),
				),
			)
			.orderBy(desc(rankSnapshots.createdAt))
			.limit(1)
			.as("before");
		const seed = db.$with("seed").as(
			db
				.select({
					country: tk.country,
					keyword: tk.keyword,
					position: sql<number | null>`${before.position}`.as("seed_position"),
				})
				.from(tk)
				.innerJoinLateral(before, sql`true`),
		);

		const fresh = db.$with("fresh").as(
			db
				.selectDistinct({
					country: recent.country,
					day: sql<string>`${recent.day}`.as("fresh_day"),
				})
				.from(recent),
		);

		// Every keyword of a market on every measured day of that market. `grp`
		// grows by one at each fresh measurement, so a run of days with the
		// same `grp` shares the position measured at its start.
		const grid = db.$with("grid").as(
			db
				.select({
					addedDay: tk.addedDay,
					brand: tk.brand,
					country: fresh.country,
					day: sql<string>`${fresh.day}`.as("grid_day"),
					grp: sql<number>`count(${recent.keyword}) over (partition by ${fresh.country}, ${tk.keyword} order by ${fresh.day})`.as(
						"grid_grp",
					),
					hasMeasurement: sql<boolean>`${recent.keyword} is not null`.as(
						"grid_measured",
					),
					keyword: tk.keyword,
					position: sql<number | null>`${recent.position}`.as("grid_position"),
				})
				.from(fresh)
				.innerJoin(tk, eq(tk.country, fresh.country))
				.leftJoin(
					recent,
					and(
						eq(recent.country, fresh.country),
						eq(recent.keyword, tk.keyword),
						eq(recent.day, fresh.day),
					),
				),
		);

		const state = db.$with("state").as(
			db
				.select({
					brand: grid.brand,
					country: grid.country,
					day: grid.day,
					hasMeasurement: grid.hasMeasurement,
					position: sql<
						number | null
					>`case when ${grid.grp} = 0 then ${seed.position} else first_value(${grid.position}) over (partition by ${grid.country}, ${grid.keyword}, ${grid.grp} order by ${grid.day}) end`.as(
						"state_position",
					),
					started:
						sql<boolean>`(${grid.grp} > 0 or ${seed.keyword} is not null or ${grid.addedDay} <= ${grid.day})`.as(
							"state_started",
						),
				})
				.from(grid)
				.leftJoin(
					seed,
					and(eq(seed.country, grid.country), eq(seed.keyword, grid.keyword)),
				),
		);

		const earned = sql`not ${state.brand}`;
		const rows = await db
			.with(tk, recent, seed, fresh, grid, state)
			.select({
				country: state.country,
				day: sql<string>`to_char(${state.day}, 'YYYY-MM-DD')`,
				measured: sql<number>`(count(*) filter (where ${state.hasMeasurement}))::int`,
				median: sql<
					number | null
				>`(percentile_cont(0.5) within group (order by ${state.position}) filter (where ${earned}))::float8`,
				ranked: sql<number>`(count(${state.position}) filter (where ${earned}))::int`,
				top10: sql<number>`(count(*) filter (where ${earned} and ${state.position} <= ${TOP_VISIBLE}))::int`,
				top50: sql<number>`(count(*) filter (where ${earned} and ${state.position} <= ${TOP_SCANNED}))::int`,
				tracked: sql<number>`(count(*) filter (where ${state.started}))::int`,
			})
			.from(state)
			.groupBy(state.country, state.day)
			.orderBy(state.country, state.day);

		const byCountry = new Map<string, TrackingMarketHistory>(
			countries.map((country) => [country, { country, points: [] }]),
		);
		for (const row of rows) {
			byCountry.get(row.country)?.points.push({
				day: row.day,
				measured: Number(row.measured),
				median: roundMedian(row.median),
				ranked: Number(row.ranked),
				top10: Number(row.top10),
				top50: Number(row.top50),
				tracked: Number(row.tracked),
			});
		}

		return { from, markets: [...byCountry.values()], timeZone, to };
	}
}

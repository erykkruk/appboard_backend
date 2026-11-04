import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import config from "@/config";
import { appstoreLookupRaw } from "@/modules/research/appstore.client";
import { playstoreAppRaw } from "@/modules/research/playstore.client";
import type { ResearchStore } from "@/modules/research/research.types";
import { publicCountryFor } from "@/modules/stores/provider-resolver";
import {
	breakerPacer,
	describeStoreError,
	STORE_THROTTLED_CODE,
	StoreBreaker,
} from "@/modules/tracking/rank-lookup";
import { DEFAULT_SCHEDULER_TZ } from "@/modules/tracking/tracking.types";
import { db } from "@/utils/db";
import {
	appRatingRefreshes,
	appRatingSnapshots,
	apps,
	reviews,
	stores,
	trackedKeywords,
} from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";
import {
	aggregateRatings,
	RATING_SNAPSHOT_MAX_LAG_DAYS,
} from "./ratings.aggregate";
import { daysBetween, localClock } from "./ratings.clock";
import { parseItunesLookupRating, parsePlayAppRating } from "./ratings.parsers";
import {
	type CountryRating,
	RATING_STORE_TYPES,
	type RatingHistogram,
	type RatingScope,
	type RatingSnapshotRow,
	type RatingStoreType,
	type RatingsSummary,
} from "./ratings.types";
import { ReviewsService, resolveReviewScope } from "./reviews.service";
import { countryFromTerritory, STORE_COUNTRY_CODES } from "./store-countries";

const log = createLogger("ratings");

/** Every storefront is checked at least this often; rated ones daily. */
export const FULL_SWEEP_EVERY_DAYS = 7;
/** A run a store throttled (or that failed) is not retried before this. */
export const RATINGS_RETRY_AFTER_MS = 30 * 60 * 1000;
/** Progress is written every this many countries, so a restart loses little. */
const PROGRESS_SAVE_EVERY = 10;
const HTTP_NOT_FOUND = 404;

const RESEARCH_STORE: Record<RatingStoreType, ResearchStore> = {
	app_store: "appstore",
	google_play: "playstore",
};

export type RatingFetcher = (
	storeType: RatingStoreType,
	externalId: string,
	country: string,
) => Promise<CountryRating | null>;

async function fetchPublicRating(
	storeType: RatingStoreType,
	externalId: string,
	country: string,
): Promise<CountryRating | null> {
	if (storeType === "app_store") {
		return parseItunesLookupRating(
			await appstoreLookupRaw(externalId, country),
			country,
		);
	}
	try {
		return parsePlayAppRating(
			await playstoreAppRaw(externalId, country),
			country,
		);
	} catch (err) {
		// Not sold in this country: an answer, not a failure. Counting it as
		// one would trip the run's breaker on a long row of such countries.
		if (describeStoreError(err).status === HTTP_NOT_FOUND) return null;
		throw err;
	}
}

let fetchRating: RatingFetcher = fetchPublicRating;

/** Swap the store fetcher (tests). Call without an argument to restore it. */
export function setRatingFetcher(fetcher?: RatingFetcher): void {
	fetchRating = fetcher ?? fetchPublicRating;
}

function schedulerTz(): string {
	return config.SCHEDULER_TZ || DEFAULT_SCHEDULER_TZ;
}

function isRatingStore(type: string): type is RatingStoreType {
	return (RATING_STORE_TYPES as readonly string[]).includes(type);
}

function isThrottled(err: unknown): boolean {
	const code = (err as { response?: { data?: { code?: unknown } } } | null)
		?.response?.data?.code;
	return code === STORE_THROTTLED_CODE;
}

/** Apps refreshing right now, by the scheduler or a manual refresh. */
const refreshing = new Set<string>();

export type RefreshOutcome =
	| "completed"
	| "already_done"
	| "running"
	| "skipped"
	| "throttled"
	| "failed";

interface RefreshOptions {
	/** Start over even when today's run already finished. */
	force?: boolean;
	now?: Date;
}

type RefreshState = typeof appRatingRefreshes.$inferSelect;

export class RatingsService {
	static isRefreshing(appId: string): boolean {
		return refreshing.has(appId);
	}

	/**
	 * Rated countries of the last days, tracked markets, the import country
	 * and the countries reviews came from: what a daily (not full) run checks.
	 */
	static async activeCountries(
		app: { id: string; rawData: unknown },
		day: string,
	): Promise<string[]> {
		const since = new Date(
			Date.parse(`${day}T00:00:00Z`) -
				RATING_SNAPSHOT_MAX_LAG_DAYS * 24 * 60 * 60 * 1000,
		)
			.toISOString()
			.slice(0, 10);
		const [rated, tracked, territories] = await Promise.all([
			db
				.selectDistinct({ country: appRatingSnapshots.country })
				.from(appRatingSnapshots)
				.where(
					and(
						eq(appRatingSnapshots.appId, app.id),
						gte(appRatingSnapshots.day, since),
					),
				),
			db
				.selectDistinct({ country: trackedKeywords.country })
				.from(trackedKeywords)
				.where(eq(trackedKeywords.appId, app.id)),
			db
				.selectDistinct({ territory: reviews.territory })
				.from(reviews)
				.where(eq(reviews.appId, app.id)),
		]);
		const wanted = new Set<string>([
			...rated.map((r) => r.country.toLowerCase()),
			...tracked.map((r) => r.country.toLowerCase()),
			...territories
				.map((r) => countryFromTerritory(r.territory))
				.filter((c): c is string => c !== null),
		]);
		const raw = app.rawData as { publicCountry?: unknown } | null;
		if (typeof raw?.publicCountry === "string") {
			wanted.add(publicCountryFor(app).toLowerCase());
		}
		return STORE_COUNTRY_CODES.filter((cc) => wanted.has(cc));
	}

	private static async startState(
		appId: string,
		day: string,
		previous: RefreshState | undefined,
	): Promise<RefreshState> {
		const lastFull = previous?.lastFullSweepDay ?? null;
		const fullSweep =
			lastFull === null || daysBetween(lastFull, day) >= FULL_SWEEP_EVERY_DAYS;
		const values = {
			appId,
			completedAt: null,
			day,
			doneCountries: [] as string[],
			fullSweep,
			lastError: null,
			lastFullSweepDay: lastFull,
			nextAttemptAt: null,
			reviewsSynced: false,
		};
		const [row] = await db
			.insert(appRatingRefreshes)
			.values(values)
			.onConflictDoUpdate({ set: values, target: appRatingRefreshes.appId })
			.returning();
		return row;
	}

	private static async saveState(
		appId: string,
		patch: Partial<typeof appRatingRefreshes.$inferInsert>,
	): Promise<void> {
		await db
			.update(appRatingRefreshes)
			.set(patch)
			.where(eq(appRatingRefreshes.appId, appId));
	}

	/** App Store reviews with text per country, from AppBoard's own table. */
	static async writtenReviewsByCountry(
		appIds: string[],
	): Promise<Map<string, number>> {
		if (!appIds.length) return new Map();
		const rows = await db
			.select({
				appId: reviews.appId,
				count: sql<number>`count(*)::int`,
				territory: reviews.territory,
			})
			.from(reviews)
			.where(inArray(reviews.appId, appIds))
			.groupBy(reviews.appId, reviews.territory);
		const counts = new Map<string, number>();
		for (const row of rows) {
			const country = countryFromTerritory(row.territory);
			if (!country) continue;
			const key = `${row.appId}:${country}`;
			counts.set(key, (counts.get(key) ?? 0) + row.count);
		}
		return counts;
	}

	/**
	 * Refresh one app's public ratings for today, paced through the shared
	 * store throttle. Resumes a run cut short earlier the same day (only the
	 * countries not done yet are fetched). API-connected apps also pull their
	 * written reviews first, once a day: Google Play's API only returns the
	 * last 7 days, so a day without a sync loses reviews for good.
	 */
	static async refreshApp(
		appId: string,
		options: RefreshOptions = {},
	): Promise<RefreshOutcome> {
		if (refreshing.has(appId)) return "running";
		refreshing.add(appId);
		const now = options.now ?? new Date();
		try {
			const [row] = await db
				.select({ app: apps, store: stores })
				.from(apps)
				.innerJoin(stores, eq(apps.storeId, stores.id))
				.where(eq(apps.id, appId))
				.limit(1);
			if (!row || !isRatingStore(row.store.type)) return "skipped";
			const storeType = row.store.type;
			const { day } = localClock(now, schedulerTz());

			const [existing] = await db
				.select()
				.from(appRatingRefreshes)
				.where(eq(appRatingRefreshes.appId, appId))
				.limit(1);
			let state = existing;
			if (!state || state.day !== day || options.force) {
				state = await RatingsService.startState(appId, day, existing);
			} else if (state.completedAt) {
				return "already_done";
			}

			if (!state.reviewsSynced && row.store.connectionMode !== "public") {
				try {
					await ReviewsService.syncFromStore(appId);
				} catch (err) {
					log.warn({ appId, err }, "Daily review sync failed");
				}
				await RatingsService.saveState(appId, { reviewsSynced: true });
			}

			const countries = state.fullSweep
				? [...STORE_COUNTRY_CODES]
				: await RatingsService.activeCountries(row.app, day);
			// A first run with nothing known yet checks every storefront.
			const toCheck = countries.length ? countries : [...STORE_COUNTRY_CODES];
			const done = new Set(state.doneCountries);
			const written =
				storeType === "app_store"
					? await RatingsService.writtenReviewsByCountry([appId])
					: new Map<string, number>();

			const pace = breakerPacer(
				RESEARCH_STORE[storeType],
				new StoreBreaker(Date.now),
			);
			let sinceSave = 0;
			for (const country of toCheck) {
				if (done.has(country)) continue;
				let rating: CountryRating | null = null;
				try {
					rating = await pace(() =>
						fetchRating(storeType, row.app.externalId, country),
					);
				} catch (err) {
					if (isThrottled(err)) {
						await RatingsService.saveState(appId, {
							doneCountries: [...done],
							lastError: describeStoreError(err).message,
							nextAttemptAt: new Date(now.getTime() + RATINGS_RETRY_AFTER_MS),
						});
						log.warn(
							{ appId, done: done.size, total: toCheck.length },
							"Ratings refresh paused: store throttled",
						);
						return "throttled";
					}
					log.warn({ appId, country, err }, "Rating lookup failed");
				}
				if (rating && rating.ratingCount > 0) {
					await RatingsService.saveSnapshot(appId, storeType, day, {
						...rating,
						writtenReviews:
							storeType === "app_store"
								? (written.get(`${appId}:${country}`) ?? 0)
								: rating.writtenReviews,
					});
				}
				done.add(country);
				if (++sinceSave >= PROGRESS_SAVE_EVERY) {
					sinceSave = 0;
					await RatingsService.saveState(appId, { doneCountries: [...done] });
				}
			}

			await RatingsService.saveState(appId, {
				completedAt: new Date(),
				doneCountries: [...done],
				lastError: null,
				...(state.fullSweep ? { lastFullSweepDay: day } : {}),
				nextAttemptAt: null,
			});
			log.info(
				{ appId, countries: toCheck.length, fullSweep: state.fullSweep },
				"Ratings refreshed",
			);
			return "completed";
		} catch (err) {
			log.error({ appId, err }, "Ratings refresh failed");
			await RatingsService.saveState(appId, {
				lastError: err instanceof Error ? err.message : String(err),
				nextAttemptAt: new Date(now.getTime() + RATINGS_RETRY_AFTER_MS),
			}).catch(() => undefined);
			return "failed";
		} finally {
			refreshing.delete(appId);
		}
	}

	private static async saveSnapshot(
		appId: string,
		storeType: RatingStoreType,
		day: string,
		rating: CountryRating,
	): Promise<void> {
		const values = {
			appId,
			average: rating.average,
			country: rating.country,
			currentVersionAverage: rating.currentVersionAverage,
			currentVersionRatingCount: rating.currentVersionRatingCount,
			day,
			fetchedAt: new Date(),
			histogram: rating.histogram,
			ratingCount: rating.ratingCount,
			storeType,
			version: rating.version,
			writtenReviews: rating.writtenReviews,
		};
		await db
			.insert(appRatingSnapshots)
			.values(values)
			.onConflictDoUpdate({
				set: values,
				target: [
					appRatingSnapshots.appId,
					appRatingSnapshots.country,
					appRatingSnapshots.day,
				],
			});
	}

	/** Apps whose ratings the daily job refreshes (live store listings). */
	static async listRefreshableApps(): Promise<
		{ appId: string; storeType: RatingStoreType }[]
	> {
		const rows = await db
			.select({ appId: apps.id, rawData: apps.rawData, storeType: stores.type })
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(
				and(
					eq(apps.status, "active"),
					inArray(stores.type, [...RATING_STORE_TYPES]),
				),
			);
		return rows
			.filter(
				(r) =>
					(r.rawData as { notInStore?: unknown } | null)?.notInStore !== true,
			)
			.map((r) => ({
				appId: r.appId,
				storeType: r.storeType as RatingStoreType,
			}));
	}

	static async getStates(appIds: string[]): Promise<Map<string, RefreshState>> {
		if (!appIds.length) return new Map();
		const rows = await db
			.select()
			.from(appRatingRefreshes)
			.where(inArray(appRatingRefreshes.appId, appIds));
		return new Map(rows.map((r) => [r.appId, r]));
	}

	/**
	 * Ratings per store and country for an app, or summed over its app group
	 * (`scope=group`). Listings shared by two records are counted once.
	 */
	static async getSummary(
		appId: string,
		workspaceId: string,
		scope: RatingScope,
	): Promise<RatingsSummary> {
		const resolved = await resolveReviewScope(appId, workspaceId, scope);
		const appRows = await db
			.select({
				devices: apps.devices,
				externalId: apps.externalId,
				id: apps.id,
				name: apps.name,
				platform: apps.platform,
				storeType: stores.type,
			})
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(
				and(
					inArray(apps.id, resolved.appIds),
					eq(stores.workspaceId, workspaceId),
				),
			);
		const appIds = appRows.map((a) => a.id);
		const byId = new Map(appRows.map((a) => [a.id, a]));

		const snapshotRows = appIds.length
			? await db
					.select()
					.from(appRatingSnapshots)
					.where(inArray(appRatingSnapshots.appId, appIds))
					.orderBy(desc(appRatingSnapshots.day))
			: [];
		const written = await RatingsService.writtenReviewsByCountry(appIds);
		const rows: RatingSnapshotRow[] = snapshotRows
			.filter((s) => isRatingStore(s.storeType))
			.map((s) => ({
				appId: s.appId,
				average: s.average,
				country: s.country,
				day: s.day,
				externalId: byId.get(s.appId)?.externalId ?? s.appId,
				fetchedAt: s.fetchedAt,
				histogram: (s.histogram as RatingHistogram | null) ?? null,
				ratingCount: s.ratingCount,
				storeType: s.storeType as RatingStoreType,
				// App Store counts reviews with text from our own table, live,
				// so a review synced after the snapshot is counted at once.
				writtenReviews:
					s.storeType === "app_store"
						? (written.get(`${s.appId}:${s.country}`) ?? 0)
						: s.writtenReviews,
			}));

		const syncedRows = appIds.length
			? await db
					.select({
						count: sql<number>`count(*)::int`,
						storeType: reviews.storeType,
					})
					.from(reviews)
					.where(inArray(reviews.appId, appIds))
					.groupBy(reviews.storeType)
			: [];
		const synced: Partial<Record<RatingStoreType, number>> = {};
		for (const r of syncedRows) {
			if (isRatingStore(r.storeType)) synced[r.storeType] = r.count;
		}

		const { stores: storeSummaries, total } = aggregateRatings(rows, synced);
		const states = await RatingsService.getStates(appIds);

		// Nothing measured yet (a fresh app, or right after this shipped):
		// start the first refresh now instead of waiting for the night.
		if (config.NODE_ENV !== "test") {
			for (const app of appRows) {
				if (!isRatingStore(app.storeType) || states.has(app.id)) continue;
				void RatingsService.refreshApp(app.id);
			}
		}

		const fetchedAt = storeSummaries.reduce<string | null>(
			(max, s) =>
				s.fetchedAt && (max === null || s.fetchedAt > max) ? s.fetchedAt : max,
			null,
		);
		return {
			apps: appRows.map((a) => ({
				appId: a.id,
				devices: (a.devices as string[] | null) ?? [],
				externalId: a.externalId,
				lastRefreshedAt: states.get(a.id)?.completedAt?.toISOString() ?? null,
				name: a.name,
				platform: a.platform,
				storeType: a.storeType,
			})),
			fetchedAt,
			group: resolved.group,
			refreshing: appIds.some((id) => refreshing.has(id)),
			scope: resolved.group ? "group" : "app",
			stores: storeSummaries,
			total,
		};
	}

	/**
	 * Start a refresh of the app (or its whole group) in the background.
	 * Returns the apps it started for; one already running is left alone.
	 */
	static async startRefresh(
		appId: string,
		workspaceId: string,
		scope: RatingScope,
	): Promise<{ started: string[] }> {
		const { appIds } = await resolveReviewScope(appId, workspaceId, scope);
		const started = appIds.filter((id) => !refreshing.has(id));
		const run = (async () => {
			for (const id of started) {
				await RatingsService.refreshApp(id, { force: true });
			}
		})();
		if (config.NODE_ENV === "test") await run;
		return { started };
	}
}

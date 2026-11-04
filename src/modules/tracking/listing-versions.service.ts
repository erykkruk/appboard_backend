import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { marketLanguage } from "@/modules/research/listing-audit";
import type { ResearchStore } from "@/modules/research/research.types";
import { db } from "@/utils/db";
import {
	appEvents,
	appVersions,
	listings,
	listingVersions,
	rankSnapshots,
	trackedKeywords,
	versionLocalizations,
} from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";
import { AppEventsService } from "./app-events.service";
import {
	type ByVersionCell,
	type ByVersionColumn,
	type ByVersionKeyword,
	type ListingState,
	type ListingText,
	type ListingTextField,
	type RankByVersion,
	UNKNOWN_VERSION_KEY,
} from "./listing-versions.types";
import { type RankLookupRuntime, throttledStoreCall } from "./rank-lookup";
import type { StorePacer, StoreRelease } from "./store-versions";
import { DEFAULT_TRACKING_COUNTRY } from "./tracking.types";

const log = createLogger("listing-versions");

/** Rows per UPDATE when attributing old snapshots. */
const BACKFILL_UPDATE_CHUNK = 1000;
/** Marks an app whose old snapshots were attributed (see `backfill`). */
export const BACKFILL_EVENT_TYPE = "listing_versions_backfilled";

const TEXT_FIELDS: ListingTextField[] = ["title", "subtitle", "keywords"];

/** Store language codes that name the same language. */
const LANGUAGE_ALIASES: Record<string, string[]> = {
	he: ["he", "iw"],
	nb: ["nb", "no"],
	no: ["no", "nb"],
};
/**
 * Store countries the audit's market map leaves out (it skips everything a
 * listing in English already serves). Explicit on purpose: a country code is
 * not a language code (ar = Argentina, not Arabic; ca = Canada, not Catalan).
 */
const EXTRA_MARKET_LANGUAGE: Record<string, string> = {
	al: "sq",
	ar: "es",
	bg: "bg",
	bh: "ar",
	bo: "es",
	by: "be",
	cr: "es",
	do: "es",
	ec: "es",
	ee: "et",
	eg: "ar",
	gt: "es",
	hk: "zh",
	hn: "es",
	hr: "hr",
	is: "is",
	jo: "ar",
	kw: "ar",
	lb: "ar",
	lt: "lt",
	lv: "lv",
	mk: "mk",
	mo: "zh",
	my: "ms",
	ni: "es",
	om: "ar",
	pa: "es",
	pe: "es",
	py: "es",
	qa: "ar",
	rs: "sr",
	si: "sl",
	sk: "sk",
	sv: "es",
	uy: "es",
	ve: "es",
};
const TRADITIONAL_CHINESE_COUNTRIES = new Set(["hk", "mo", "tw"]);
const LATIN_AMERICAN_SPANISH = "es-419";
const ENGLISH = "en";
const DEFAULT_ENGLISH = "en-us";

export interface ListingVersionApp {
	externalId: string;
	id: string;
	platform: string;
}

function clean(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

/** Same state, same hash: the version and every text field that ranks. */
export function listingFingerprint(state: ListingState): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				clean(state.versionString),
				clean(state.language)?.toLowerCase() ?? null,
				clean(state.title),
				clean(state.subtitle),
				clean(state.keywords),
			]),
		)
		.digest("hex");
}

/**
 * Which of the app's listing languages a store country shows. Regional
 * variants first (en-GB in gb, es-MX in mx, zh-Hant in tw), then the bare
 * language, then its main variant. NULL = the app has no listing that fits.
 */
export function marketListingLanguage(
	country: string,
	languages: string[],
): string | null {
	const cc = country.toLowerCase();
	const byLower = new Map(languages.map((l) => [l.toLowerCase(), l]));
	const pick = (candidate: string) => byLower.get(candidate.toLowerCase());
	const prefixed = (lang: string) =>
		[...byLower.keys()].filter((l) => l.startsWith(`${lang}-`)).sort();

	const base = marketLanguage(cc) ?? EXTRA_MARKET_LANGUAGE[cc] ?? ENGLISH;
	const names = LANGUAGE_ALIASES[base] ?? [base];

	const candidates: string[] = [];
	for (const name of names) candidates.push(`${name}-${cc}`);
	if (base === "zh") {
		candidates.push(
			TRADITIONAL_CHINESE_COUNTRIES.has(cc) ? "zh-hant" : "zh-hans",
		);
	}
	if (base === "es" && cc !== "es") candidates.push(LATIN_AMERICAN_SPANISH);
	for (const name of names) candidates.push(name, `${name}-${name}`);
	if (base === ENGLISH) candidates.push(DEFAULT_ENGLISH);
	for (const candidate of candidates) {
		const hit = pick(candidate);
		if (hit) return hit;
	}
	for (const name of names) {
		const first = prefixed(name)[0];
		if (first) return byLower.get(first) ?? null;
	}
	return null;
}

/** For each snapshot time, the release live then (latest released at or before it). */
export function releaseAt(
	releases: StoreRelease[],
	at: Date,
): StoreRelease | null {
	let live: StoreRelease | null = null;
	for (const release of releases) {
		if (!release.releasedAt) continue;
		if (release.releasedAt.getTime() > at.getTime()) break;
		live = release;
	}
	return live;
}

function sortedReleases(releases: StoreRelease[]): StoreRelease[] {
	return releases
		.filter((r) => r.releasedAt)
		.sort(
			(a, b) => (a.releasedAt?.getTime() ?? 0) - (b.releasedAt?.getTime() ?? 0),
		);
}

function storePacer(
	store: ResearchStore,
	runtime: RankLookupRuntime,
): StorePacer {
	return (call) => throttledStoreCall(store, call, runtime);
}

export class ListingVersionService {
	/**
	 * Ranking text per listing language, as AppBoard last read it from the
	 * store. iOS: the localization of the live version when it was synced
	 * (keywords belong to a version), else the synced listing. Play: the
	 * synced listing. `versionKeywordsOnly` keeps only what is stored per
	 * version (rebuilding the past: an old version's title and subtitle were
	 * overwritten by later syncs, its keyword field was not).
	 */
	static async readTexts(
		app: ListingVersionApp,
		versionString: string | null,
		options: { versionKeywordsOnly?: boolean } = {},
	): Promise<Map<string, ListingText>> {
		const texts = new Map<string, ListingText>();
		if (app.platform === "ios" && versionString) {
			const rows = await db
				.select({
					keywords: versionLocalizations.keywords,
					language: versionLocalizations.language,
					subtitle: versionLocalizations.subtitle,
					title: versionLocalizations.title,
				})
				.from(versionLocalizations)
				.innerJoin(
					appVersions,
					eq(versionLocalizations.versionId, appVersions.id),
				)
				.where(
					and(
						eq(appVersions.appId, app.id),
						eq(appVersions.versionString, versionString),
						eq(versionLocalizations.source, "remote"),
					),
				)
				.orderBy(desc(versionLocalizations.syncedAt));
			for (const row of rows) {
				if (texts.has(row.language)) continue;
				texts.set(row.language, {
					keywords: clean(row.keywords),
					subtitle: options.versionKeywordsOnly ? null : clean(row.subtitle),
					title: options.versionKeywordsOnly ? null : clean(row.title),
				});
			}
		}
		if (texts.size || options.versionKeywordsOnly) return texts;

		const rows = await db
			.select({
				keywords: listings.keywords,
				language: listings.language,
				shortDesc: listings.shortDesc,
				title: listings.title,
			})
			.from(listings)
			.where(and(eq(listings.appId, app.id), eq(listings.source, "remote")));
		for (const row of rows) {
			texts.set(row.language, {
				keywords: clean(row.keywords),
				subtitle: clean(row.shortDesc),
				title: clean(row.title),
			});
		}
		return texts;
	}

	/**
	 * The listing state row for `state`: the newest row of the same (app,
	 * language) when nothing changed (its last-seen time moves on), a new row
	 * otherwise. Returns the row id.
	 */
	static async touchState(
		appId: string,
		state: ListingState,
		seenAt: Date,
	): Promise<string> {
		const fingerprint = listingFingerprint(state);
		const [latest] = await db
			.select({
				fingerprint: listingVersions.fingerprint,
				id: listingVersions.id,
				versionReleasedAt: listingVersions.versionReleasedAt,
			})
			.from(listingVersions)
			.where(
				and(
					eq(listingVersions.appId, appId),
					state.language === null
						? isNull(listingVersions.language)
						: eq(listingVersions.language, state.language),
				),
			)
			.orderBy(desc(listingVersions.firstSeenAt))
			.limit(1);
		if (latest?.fingerprint === fingerprint) {
			await db
				.update(listingVersions)
				.set({
					lastSeenAt: seenAt,
					versionReleasedAt:
						latest.versionReleasedAt ?? state.versionReleasedAt,
				})
				.where(eq(listingVersions.id, latest.id));
			return latest.id;
		}
		const [row] = await db
			.insert(listingVersions)
			.values({
				appId,
				fingerprint,
				firstSeenAt: seenAt,
				keywords: state.keywords,
				language: state.language,
				lastSeenAt: seenAt,
				subtitle: state.subtitle,
				title: state.title,
				versionReleasedAt: state.versionReleasedAt,
				versionString: state.versionString,
			})
			.returning({ id: listingVersions.id });
		return row.id;
	}

	/**
	 * Records what is live for every country of a rank-check run and returns
	 * the state id per country, to be stored on each snapshot. One public
	 * store call per run (the version is the same in every storefront); the
	 * text comes from AppBoard's synced listing. Never throws: a run must not
	 * fail because the version could not be read (its snapshots stay NULL).
	 */
	static async recordForRun(
		app: ListingVersionApp,
		store: ResearchStore,
		countries: string[],
		runtime: RankLookupRuntime,
	): Promise<Map<string, string | null>> {
		const byCountry = new Map<string, string | null>();
		const unique = [...new Set(countries.map((c) => c.toLowerCase()))];
		if (!unique.length) return byCountry;
		try {
			let release: StoreRelease | null = null;
			try {
				release = await runtime.versions.live(
					store,
					app.externalId,
					unique[0],
					storePacer(store, runtime),
				);
			} catch (err) {
				log.warn(
					{ appId: app.id, err, store },
					"Live store version unavailable - recorded as unknown",
				);
			}
			const versionString = release?.versionString ?? null;
			const texts = await ListingVersionService.readTexts(app, versionString);
			const languages = [...texts.keys()];
			const seenAt = new Date(runtime.now());
			const byLanguage = new Map<string | null, string>();
			for (const country of unique) {
				const language = marketListingLanguage(country, languages);
				let id = byLanguage.get(language);
				if (!id) {
					const text = language ? texts.get(language) : undefined;
					id = await ListingVersionService.touchState(
						app.id,
						{
							keywords: text?.keywords ?? null,
							language,
							subtitle: text?.subtitle ?? null,
							title: text?.title ?? null,
							versionReleasedAt: release?.releasedAt ?? null,
							versionString,
						},
						seenAt,
					);
					byLanguage.set(language, id);
				}
				byCountry.set(country, id);
			}
		} catch (err) {
			log.error(
				{ appId: app.id, err },
				"Could not record the live listing version",
			);
			byCountry.clear();
		}
		return byCountry;
	}

	/**
	 * Attributes snapshots measured before versions were recorded, from the
	 * release history the store publishes (App Store: the version history
	 * sheet; Play: only the live version and its update date). Rows are
	 * marked `inferred`. Snapshots older than the oldest known release stay
	 * NULL. Runs once per app: an app event marks it done, and a store that
	 * could not be read is simply tried again on the next run.
	 */
	static async backfill(
		app: ListingVersionApp,
		store: ResearchStore,
		country: string,
		runtime: RankLookupRuntime,
	): Promise<{ attributed: number; unknown: number } | null> {
		try {
			const [done] = await db
				.select({ id: appEvents.id })
				.from(appEvents)
				.where(
					and(
						eq(appEvents.appId, app.id),
						eq(appEvents.type, BACKFILL_EVENT_TYPE),
					),
				)
				.limit(1);
			if (done) return null;

			const [firstObserved] = await db
				.select({ firstSeenAt: listingVersions.firstSeenAt })
				.from(listingVersions)
				.where(
					and(
						eq(listingVersions.appId, app.id),
						eq(listingVersions.inferred, false),
					),
				)
				.orderBy(asc(listingVersions.firstSeenAt))
				.limit(1);
			const before = firstObserved?.firstSeenAt ?? new Date(runtime.now());
			const pending = await db
				.select({
					country: rankSnapshots.country,
					createdAt: rankSnapshots.createdAt,
					id: rankSnapshots.id,
				})
				.from(rankSnapshots)
				.where(
					and(
						eq(rankSnapshots.appId, app.id),
						isNull(rankSnapshots.listingVersionId),
						lt(rankSnapshots.createdAt, before),
					),
				);

			let releases: StoreRelease[] = [];
			if (pending.length) {
				try {
					releases = sortedReleases(
						await runtime.versions.history(
							store,
							app.externalId,
							country,
							storePacer(store, runtime),
						),
					);
				} catch (err) {
					log.warn(
						{ appId: app.id, err, store },
						"Store version history unavailable - backfill retried next run",
					);
					return null;
				}
			}

			const result = await ListingVersionService.attribute(
				app,
				pending,
				releases,
			);
			await AppEventsService.record(
				app.id,
				BACKFILL_EVENT_TYPE,
				"Rank history matched to store versions",
				{ ...result, releases: releases.length },
			);
			log.info({ appId: app.id, ...result }, "Listing version backfill done");
			return result;
		} catch (err) {
			log.error({ appId: app.id, err }, "Listing version backfill failed");
			return null;
		}
	}

	private static async attribute(
		app: ListingVersionApp,
		pending: Array<{ country: string; createdAt: Date; id: string }>,
		releases: StoreRelease[],
	): Promise<{ attributed: number; unknown: number }> {
		const textsByVersion = new Map<string, Map<string, ListingText>>();
		const groups = new Map<
			string,
			{
				ids: string[];
				language: string | null;
				lastAt: Date;
				release: StoreRelease;
			}
		>();
		let unknown = 0;
		for (const snapshot of pending) {
			const release = releaseAt(releases, snapshot.createdAt);
			if (!release) {
				unknown++;
				continue;
			}
			let texts = textsByVersion.get(release.versionString);
			if (!texts) {
				texts = await ListingVersionService.readTexts(
					app,
					release.versionString,
					{ versionKeywordsOnly: true },
				);
				textsByVersion.set(release.versionString, texts);
			}
			const language = marketListingLanguage(snapshot.country, [
				...texts.keys(),
			]);
			const key = `${release.versionString}\u0000${language ?? ""}`;
			const group = groups.get(key);
			if (group) {
				group.ids.push(snapshot.id);
				if (snapshot.createdAt > group.lastAt)
					group.lastAt = snapshot.createdAt;
			} else {
				groups.set(key, {
					ids: [snapshot.id],
					language,
					lastAt: snapshot.createdAt,
					release,
				});
			}
		}

		let attributed = 0;
		for (const group of groups.values()) {
			const text = group.language
				? textsByVersion.get(group.release.versionString)?.get(group.language)
				: undefined;
			const state: ListingState = {
				keywords: text?.keywords ?? null,
				language: group.language,
				subtitle: null,
				title: null,
				versionReleasedAt: group.release.releasedAt,
				versionString: group.release.versionString,
			};
			const [row] = await db
				.insert(listingVersions)
				.values({
					...state,
					appId: app.id,
					fingerprint: listingFingerprint(state),
					firstSeenAt: group.release.releasedAt ?? group.lastAt,
					inferred: true,
					lastSeenAt: group.lastAt,
				})
				.returning({ id: listingVersions.id });
			for (let i = 0; i < group.ids.length; i += BACKFILL_UPDATE_CHUNK) {
				await db
					.update(rankSnapshots)
					.set({ listingVersionId: row.id })
					.where(
						inArray(
							rankSnapshots.id,
							group.ids.slice(i, i + BACKFILL_UPDATE_CHUNK),
						),
					);
			}
			attributed += group.ids.length;
		}
		return { attributed, unknown };
	}

	/**
	 * Positions of one market per store version: per keyword the last and
	 * best position while each version was live and the change vs the
	 * previous version, plus each version's listing text and what changed in
	 * it. Versions newest first.
	 */
	static async getByVersion(
		appId: string,
		country?: string,
	): Promise<RankByVersion> {
		const cc = (
			country ?? (await ListingVersionService.firstTrackedCountry(appId))
		).toLowerCase();
		const [snapshots, tracked] = await Promise.all([
			db
				.select({
					createdAt: rankSnapshots.createdAt,
					keyword: rankSnapshots.keyword,
					listingVersionId: rankSnapshots.listingVersionId,
					position: rankSnapshots.position,
				})
				.from(rankSnapshots)
				.where(
					and(eq(rankSnapshots.appId, appId), eq(rankSnapshots.country, cc)),
				)
				.orderBy(asc(rankSnapshots.createdAt)),
			db
				.select({
					keyword: trackedKeywords.keyword,
					starred: trackedKeywords.starred,
				})
				.from(trackedKeywords)
				.where(
					and(
						eq(trackedKeywords.appId, appId),
						eq(trackedKeywords.country, cc),
					),
				),
		]);

		const stateIds = [
			...new Set(
				snapshots
					.map((s) => s.listingVersionId)
					.filter((id): id is string => id !== null),
			),
		];
		const states = stateIds.length
			? await db
					.select()
					.from(listingVersions)
					.where(inArray(listingVersions.id, stateIds))
					.orderBy(asc(listingVersions.firstSeenAt))
			: [];
		const stateById = new Map(states.map((s) => [s.id, s]));

		const keyOf = (stateId: string | null) =>
			(stateId ? stateById.get(stateId)?.versionString : null) ??
			UNKNOWN_VERSION_KEY;

		const columns = new Map<string, ByVersionColumn>();
		for (const snapshot of snapshots) {
			const key = keyOf(snapshot.listingVersionId);
			const at = snapshot.createdAt.toISOString();
			const column = columns.get(key);
			if (column) {
				column.measurements++;
				column.measuredTo = at;
			} else {
				columns.set(key, {
					changedFields: [],
					inferred: true,
					key,
					listing: null,
					listings: [],
					measuredFrom: at,
					measuredTo: at,
					measurements: 1,
					releasedAt: null,
					versionString: key === UNKNOWN_VERSION_KEY ? null : key,
				});
			}
		}
		const seenInColumn = new Map<string, Set<string>>();
		for (const snapshot of snapshots) {
			const state = snapshot.listingVersionId
				? stateById.get(snapshot.listingVersionId)
				: undefined;
			if (!state) continue;
			const column = columns.get(keyOf(state.id));
			if (!column) continue;
			const seen = seenInColumn.get(column.key) ?? new Set<string>();
			seenInColumn.set(column.key, seen);
			if (!state.inferred) column.inferred = false;
			if (state.versionReleasedAt) {
				column.releasedAt = state.versionReleasedAt.toISOString();
			}
			if (seen.has(state.id)) continue;
			seen.add(state.id);
			column.listings.push({
				firstSeenAt: state.firstSeenAt.toISOString(),
				id: state.id,
				inferred: state.inferred,
				keywords: state.keywords,
				language: state.language,
				lastSeenAt: state.lastSeenAt.toISOString(),
				subtitle: state.subtitle,
				title: state.title,
			});
		}
		for (const column of columns.values()) {
			if (column.key === UNKNOWN_VERSION_KEY) column.inferred = false;
			column.listings.sort((a, b) =>
				a.firstSeenAt.localeCompare(b.firstSeenAt),
			);
			column.listing = ListingVersionService.latestText(column.listings);
		}

		const oldestFirst = [...columns.values()].sort((a, b) =>
			a.measuredFrom.localeCompare(b.measuredFrom),
		);
		for (let i = 1; i < oldestFirst.length; i++) {
			const prev = oldestFirst[i - 1].listing;
			const cur = oldestFirst[i].listing;
			if (!prev || !cur) continue;
			oldestFirst[i].changedFields = TEXT_FIELDS.filter(
				(f) => prev[f] !== null && cur[f] !== null && prev[f] !== cur[f],
			);
		}

		const keywords = ListingVersionService.cells(
			snapshots.map((s) => ({ ...s, key: keyOf(s.listingVersionId) })),
			tracked,
			oldestFirst.map((c) => c.key),
		);
		return { country: cc, keywords, versions: oldestFirst.reverse() };
	}

	/** Same default market as the board: the first tracked country. */
	private static async firstTrackedCountry(appId: string): Promise<string> {
		const [first] = await db
			.select({ country: trackedKeywords.country })
			.from(trackedKeywords)
			.where(eq(trackedKeywords.appId, appId))
			.orderBy(asc(trackedKeywords.country))
			.limit(1);
		return first?.country ?? DEFAULT_TRACKING_COUNTRY;
	}

	/** Field by field, the newest known value: a later row may know less (inferred). */
	private static latestText(
		rows: Array<ListingText & { firstSeenAt: string }>,
	): ListingText | null {
		if (!rows.length) return null;
		const text: ListingText = { keywords: null, subtitle: null, title: null };
		for (const row of rows) {
			for (const field of TEXT_FIELDS) {
				if (row[field] !== null) text[field] = row[field];
			}
		}
		return text;
	}

	private static cells(
		snapshots: Array<{
			createdAt: Date;
			key: string;
			keyword: string;
			position: number | null;
		}>,
		tracked: Array<{ keyword: string; starred: boolean }>,
		keysOldestFirst: string[],
	): ByVersionKeyword[] {
		const byKeyword = new Map<string, ByVersionKeyword>();
		for (const t of tracked) {
			byKeyword.set(t.keyword, {
				cells: {},
				keyword: t.keyword,
				starred: t.starred,
				tracked: true,
			});
		}
		for (const snapshot of snapshots) {
			let row = byKeyword.get(snapshot.keyword);
			if (!row) {
				row = {
					cells: {},
					keyword: snapshot.keyword,
					starred: false,
					tracked: false,
				};
				byKeyword.set(snapshot.keyword, row);
			}
			const cell: ByVersionCell = row.cells[snapshot.key] ?? {
				best: null,
				delta: null,
				last: null,
				measurements: 0,
				ranked: 0,
			};
			cell.measurements++;
			// Snapshots arrive oldest first, so the last one written wins.
			cell.last = snapshot.position;
			if (snapshot.position !== null) {
				cell.ranked++;
				cell.best =
					cell.best === null
						? snapshot.position
						: Math.min(cell.best, snapshot.position);
			}
			row.cells[snapshot.key] = cell;
		}
		for (const row of byKeyword.values()) {
			let previous: ByVersionCell | undefined;
			for (const key of keysOldestFirst) {
				const cell = row.cells[key];
				if (!cell) continue;
				if (previous && previous.last !== null && cell.last !== null) {
					cell.delta = previous.last - cell.last;
				}
				previous = cell;
			}
		}
		return [...byKeyword.values()].sort(
			(a, b) =>
				Number(b.starred) - Number(a.starred) ||
				a.keyword.localeCompare(b.keyword),
		);
	}
}

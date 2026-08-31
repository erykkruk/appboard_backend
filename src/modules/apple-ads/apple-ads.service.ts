import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { SettingsService } from "@/modules/settings/settings.service";
import { db } from "@/utils/db";
import {
	appleDatasetWeeks,
	appleImpressionShares,
	appleTopTerms,
	apps,
	keywordScoreSnapshots,
	settings,
} from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import {
	type AppleAdsCredentials,
	type AppleTopTermRow,
	getMe,
	latestAvailableWeek,
	listAcls,
	queryImpressionShare,
	queryTopTermsPage,
	weekStartSunday,
} from "./apple-ads.client";

const log = createLogger("apple-ads");

// Settings keys (workspace-scoped; the private key is encrypted at rest).
export const APPLE_ADS_SETTING_KEYS = {
	adAccountId: "APPLE_ADS_AD_ACCOUNT_ID",
	clientId: "APPLE_ADS_CLIENT_ID",
	keyId: "APPLE_ADS_KEY_ID",
	orgId: "APPLE_ADS_ORG_ID",
	privateKey: "APPLE_ADS_PRIVATE_KEY",
	source: "POPULARITY_SOURCE",
	teamId: "APPLE_ADS_TEAM_ID",
} as const;

export type PopularitySource = "internal" | "apple";

// Sync bounds: a full country-week is 15 genres x up to 500 terms, so two
// 5000-row pages cover it; the third page is a safety margin.
const MAX_SYNC_PAGES = 3;
const PAGE_PACING_MS = 1_000;
const INSERT_CHUNK = 1_000;
// Dataset-level quarantine gates (a failing week is discarded and the
// previous good week keeps serving).
const MIN_WEEK_ROWS = 500;
const MIN_GENRES = 5;
const MAX_CONSTANT_SHARE = 0.9;
// Rolling retention per country.
const WEEKS_RETAINED = 26;
const IMPRESSION_WEEKS_PER_QUERY = 4;

// ── iTunes genre -> Apple Ads genre bucket ────────────────────────────

const ITUNES_TO_APPLE_GENRE: Record<string, string> = {
	book: "NEW_PUBLICATION",
	books: "NEW_PUBLICATION",
	business: "BUSINESS",
	"developer tools": "PRODUCTIVITY_UTILITIES",
	education: "EDUCATION",
	entertainment: "ENTERTAINMENT",
	finance: "FINANCE",
	"food & drink": "FOOD_DRINK",
	"graphics & design": "PRODUCTIVITY_UTILITIES",
	"health & fitness": "HEALTH_FITNESS",
	lifestyle: "LIFESTYLE",
	"magazines & newspapers": "NEW_PUBLICATION",
	medical: "HEALTH_FITNESS",
	music: "ENTERTAINMENT",
	navigation: "TRAVEL",
	news: "NEW_PUBLICATION",
	"photo & video": "PHOTO_VIDEO",
	productivity: "PRODUCTIVITY_UTILITIES",
	reference: "EDUCATION",
	shopping: "SHOPPING",
	"social networking": "SOCIAL_NETWORKING",
	sports: "SPORTS",
	stickers: "ENTERTAINMENT",
	travel: "TRAVEL",
	utilities: "PRODUCTIVITY_UTILITIES",
	weather: "PRODUCTIVITY_UTILITIES",
};

export function mapItunesGenre(primaryGenreName: string): string | null {
	const name = (primaryGenreName ?? "").trim().toLowerCase();
	if (!name) return null;
	if (name.startsWith("games") || name === "game") return "GAMES";
	return ITUNES_TO_APPLE_GENRE[name] ?? null;
}

/**
 * Infer a keyword's Apple genre bucket from its competitors: majority vote
 * over the top results' genres. Null when nothing maps (callers fall back
 * to the country's global floor - always the most conservative cap).
 */
export function inferAppleGenre(
	competitors: Array<{ genre?: string }>,
	topN = 10,
): string | null {
	const votes = new Map<string, number>();
	for (const c of competitors.slice(0, topN)) {
		const bucket = mapItunesGenre(c.genre ?? "");
		if (bucket) votes.set(bucket, (votes.get(bucket) ?? 0) + 1);
	}
	let best: string | null = null;
	let bestCount = 0;
	for (const [bucket, count] of votes) {
		if (count > bestCount) {
			best = bucket;
			bestCount = count;
		}
	}
	return best;
}

// ── Row validation (quarantine, per-row layer) ────────────────────────

interface CleanRow {
	country: string;
	genre: string;
	popularity: number;
	popularityInGenre: number;
	popularityTier: number;
	rankInGenre: number;
	term: string;
	week: string;
}

export function cleanTopTermRows(
	rows: AppleTopTermRow[],
	country: string,
	week: string,
): CleanRow[] {
	const cleaned: CleanRow[] = [];
	for (const row of rows) {
		const term = row.searchTerm;
		const genre = row.genre;
		const rank = row.rankInGenre;
		const inGenre = row.searchPopularityInGenre;
		const market = row.searchPopularity1to100;
		const tier = row.searchPopularity1to5;
		if (
			typeof term !== "string" ||
			!term.trim() ||
			typeof genre !== "string" ||
			!genre ||
			typeof rank !== "number" ||
			rank < 1 ||
			rank > 500 ||
			typeof inGenre !== "number" ||
			inGenre < 1 ||
			inGenre > 100 ||
			typeof market !== "number" ||
			market < 1 ||
			market > 100 ||
			typeof tier !== "number" ||
			tier < 1 ||
			tier > 5
		) {
			continue;
		}
		cleaned.push({
			country,
			genre: genre.slice(0, 100),
			popularity: market,
			popularityInGenre: inGenre,
			popularityTier: tier,
			rankInGenre: rank,
			term: term.toLowerCase().trim().slice(0, 200),
			week,
		});
	}
	return cleaned;
}

/** Dataset-level sanity gate. Returns "" when sane, else the reason. */
export function weekSanityIssue(rows: CleanRow[]): string {
	if (rows.length < MIN_WEEK_ROWS) {
		return `only ${rows.length} valid rows (need ${MIN_WEEK_ROWS})`;
	}
	const genres = new Set(rows.map((r) => r.genre));
	if (genres.size < MIN_GENRES) {
		return `only ${genres.size} genres (need ${MIN_GENRES})`;
	}
	const counts = new Map<number, number>();
	for (const r of rows) {
		counts.set(r.popularity, (counts.get(r.popularity) ?? 0) + 1);
	}
	const mostCommon = Math.max(...counts.values());
	if (mostCommon / rows.length > MAX_CONSTANT_SHARE) {
		return "popularity values are near-constant";
	}
	return "";
}

// ── Service ───────────────────────────────────────────────────────────

export class AppleAdsService {
	/** Stored credentials for a workspace, or null when not connected. */
	static async getCredentials(
		workspaceId: string,
	): Promise<AppleAdsCredentials | null> {
		const [clientId, teamId, keyId, privateKey, adAccountId] =
			await Promise.all([
				SettingsService.getRaw(workspaceId, APPLE_ADS_SETTING_KEYS.clientId),
				SettingsService.getRaw(workspaceId, APPLE_ADS_SETTING_KEYS.teamId),
				SettingsService.getRaw(workspaceId, APPLE_ADS_SETTING_KEYS.keyId),
				SettingsService.getRaw(workspaceId, APPLE_ADS_SETTING_KEYS.privateKey),
				SettingsService.getRaw(workspaceId, APPLE_ADS_SETTING_KEYS.adAccountId),
			]);
		if (!clientId || !teamId || !keyId || !privateKey) return null;
		return {
			adAccountId: adAccountId ?? undefined,
			clientId,
			keyId,
			privateKey,
			teamId,
		};
	}

	/**
	 * Validate the credentials against the live API (token + /me + /acls),
	 * then persist them (private key encrypted). Also stores the first ad
	 * account id, which the insights endpoints require as request context.
	 */
	static async connect(
		workspaceId: string,
		input: {
			clientId: string;
			keyId: string;
			privateKey: string;
			teamId: string;
		},
	) {
		const creds: AppleAdsCredentials = { ...input };
		const me = await getMe(creds);
		const acls = await listAcls(creds);
		const adAccountId = acls[0]?.adAccountId ?? null;
		if (!adAccountId) {
			buildError("badRequest", {
				info:
					"The Apple Ads credentials are valid but no ad account is " +
					"accessible. Grant the API user an ad-account role in the " +
					"Apple Ads UI.",
			});
		}
		await SettingsService.set(
			workspaceId,
			APPLE_ADS_SETTING_KEYS.clientId,
			input.clientId,
		);
		await SettingsService.set(
			workspaceId,
			APPLE_ADS_SETTING_KEYS.teamId,
			input.teamId,
		);
		await SettingsService.set(
			workspaceId,
			APPLE_ADS_SETTING_KEYS.keyId,
			input.keyId,
		);
		await SettingsService.set(
			workspaceId,
			APPLE_ADS_SETTING_KEYS.privateKey,
			input.privateKey,
		);
		await SettingsService.set(
			workspaceId,
			APPLE_ADS_SETTING_KEYS.adAccountId,
			adAccountId,
		);
		if (me.orgId) {
			await SettingsService.set(
				workspaceId,
				APPLE_ADS_SETTING_KEYS.orgId,
				me.orgId,
			);
		}
		return { adAccountId, orgId: me.orgId };
	}

	static async disconnect(workspaceId: string) {
		for (const key of [
			APPLE_ADS_SETTING_KEYS.clientId,
			APPLE_ADS_SETTING_KEYS.teamId,
			APPLE_ADS_SETTING_KEYS.keyId,
			APPLE_ADS_SETTING_KEYS.privateKey,
			APPLE_ADS_SETTING_KEYS.adAccountId,
			APPLE_ADS_SETTING_KEYS.orgId,
		]) {
			await SettingsService.delete(workspaceId, key).catch(() => undefined);
		}
		return { success: true };
	}

	static async getSource(workspaceId: string): Promise<PopularitySource> {
		const raw = await SettingsService.getRaw(
			workspaceId,
			APPLE_ADS_SETTING_KEYS.source,
		);
		return raw === "apple" ? "apple" : "internal";
	}

	static async setSource(workspaceId: string, source: PopularitySource) {
		await SettingsService.set(
			workspaceId,
			APPLE_ADS_SETTING_KEYS.source,
			source,
		);
		return { source };
	}

	static async status(workspaceId: string) {
		const creds = await AppleAdsService.getCredentials(workspaceId);
		const orgId = await SettingsService.getRaw(
			workspaceId,
			APPLE_ADS_SETTING_KEYS.orgId,
		);
		const weeks = await db
			.select({
				country: appleDatasetWeeks.country,
				termCount: appleDatasetWeeks.termCount,
				week: appleDatasetWeeks.week,
			})
			.from(appleDatasetWeeks)
			.where(eq(appleDatasetWeeks.status, "active"))
			.orderBy(appleDatasetWeeks.country, desc(appleDatasetWeeks.week));
		const activeWeeks = new Map<
			string,
			{ country: string; termCount: number; week: string }
		>();
		for (const row of weeks) {
			if (!activeWeeks.has(row.country)) activeWeeks.set(row.country, row);
		}
		return {
			activeWeeks: [...activeWeeks.values()],
			connected: creds !== null,
			latestAvailableWeek: latestAvailableWeek(),
			orgId: orgId ?? null,
			source: await AppleAdsService.getSource(workspaceId),
		};
	}

	/** Newest ACTIVE week for a country, or null when no dataset exists. */
	static async activeWeek(country: string): Promise<string | null> {
		const [row] = await db
			.select({ week: appleDatasetWeeks.week })
			.from(appleDatasetWeeks)
			.where(
				and(
					eq(appleDatasetWeeks.country, country),
					eq(appleDatasetWeeks.status, "active"),
				),
			)
			.orderBy(desc(appleDatasetWeeks.week))
			.limit(1);
		return row?.week ?? null;
	}

	/**
	 * Download the latest completed week for a country into the local
	 * tables. No-op when that week is already active. A week that fails
	 * validation is discarded (the previous good week keeps serving).
	 */
	static async syncCountry(workspaceId: string, country: string) {
		const creds = await AppleAdsService.getCredentials(workspaceId);
		if (!creds) {
			buildError("badRequest", {
				info: "Apple Ads is not connected for this workspace.",
			});
		}
		const cc = country.toLowerCase();
		const week = latestAvailableWeek();
		const existing = await db
			.select({ id: appleDatasetWeeks.id })
			.from(appleDatasetWeeks)
			.where(
				and(
					eq(appleDatasetWeeks.country, cc),
					eq(appleDatasetWeeks.week, week),
					eq(appleDatasetWeeks.status, "active"),
				),
			)
			.limit(1);
		if (existing.length) {
			return { alreadySynced: true, country: cc, terms: 0, week };
		}

		const raw: AppleTopTermRow[] = [];
		for (let page = 0; page < MAX_SYNC_PAGES; page++) {
			if (page > 0) await Bun.sleep(PAGE_PACING_MS);
			const rows = await queryTopTermsPage(creds, cc, week, raw.length);
			raw.push(...rows);
			if (rows.length < 5000) break;
		}
		const cleaned = cleanTopTermRows(raw, cc, week);
		const issue = weekSanityIssue(cleaned);
		if (issue) {
			log.warn({ country: cc, issue, week }, "Apple week failed validation");
			buildError("storeApiError", {
				info: `Apple dataset for ${cc.toUpperCase()} week ${week} failed validation: ${issue}`,
			});
		}

		// Replace-insert the week, then activate it and prune old weeks.
		await db
			.delete(appleTopTerms)
			.where(and(eq(appleTopTerms.country, cc), eq(appleTopTerms.week, week)));
		for (let start = 0; start < cleaned.length; start += INSERT_CHUNK) {
			await db
				.insert(appleTopTerms)
				.values(cleaned.slice(start, start + INSERT_CHUNK));
		}
		await db
			.insert(appleDatasetWeeks)
			.values({
				country: cc,
				status: "active",
				termCount: cleaned.length,
				week,
			})
			.onConflictDoUpdate({
				set: { status: "active", termCount: cleaned.length },
				target: [appleDatasetWeeks.country, appleDatasetWeeks.week],
			});

		const cutoff = new Date(
			Date.now() - WEEKS_RETAINED * 7 * 24 * 60 * 60 * 1000,
		)
			.toISOString()
			.slice(0, 10);
		await db.delete(appleTopTerms).where(lt(appleTopTerms.week, cutoff));
		await db
			.delete(appleDatasetWeeks)
			.where(lt(appleDatasetWeeks.week, cutoff));

		log.info(
			{ country: cc, terms: cleaned.length, week },
			"Apple top-terms week synced",
		);
		return { alreadySynced: false, country: cc, terms: cleaned.length, week };
	}

	/**
	 * Batch context for scoring: the workspace's source setting plus the
	 * active-week Apple values for the given terms and per-genre floors.
	 * Absence of a term is definitive for the active week (not top-500 of
	 * its category); a missing dataset (no active week) means Apple says
	 * nothing about that storefront and the estimate stands uncapped.
	 */
	static async popularityContext(
		workspaceId: string,
		country: string,
		terms: string[],
	): Promise<{
		floorFor: (genre: string | null) => number | null;
		hasDataset: boolean;
		source: PopularitySource;
		values: Map<string, number>;
		week: string | null;
	}> {
		const source = await AppleAdsService.getSource(workspaceId);
		const week = await AppleAdsService.activeWeek(country.toLowerCase());
		const values = new Map<string, number>();
		const floors = new Map<string, number>();
		let globalFloor: number | null = null;
		if (week && terms.length) {
			const rows = await db
				.select({
					popularity: appleTopTerms.popularity,
					term: appleTopTerms.term,
				})
				.from(appleTopTerms)
				.where(
					and(
						eq(appleTopTerms.country, country.toLowerCase()),
						eq(appleTopTerms.week, week),
						inArray(appleTopTerms.term, terms),
					),
				);
			for (const row of rows) {
				const prev = values.get(row.term);
				if (prev === undefined || row.popularity > prev) {
					values.set(row.term, row.popularity);
				}
			}
			const floorRows = await db
				.select({
					floor: sql<number>`min(${appleTopTerms.popularity})::int`,
					genre: appleTopTerms.genre,
				})
				.from(appleTopTerms)
				.where(
					and(
						eq(appleTopTerms.country, country.toLowerCase()),
						eq(appleTopTerms.week, week),
					),
				)
				.groupBy(appleTopTerms.genre);
			for (const row of floorRows) {
				floors.set(row.genre, row.floor);
				if (globalFloor === null || row.floor < globalFloor) {
					globalFloor = row.floor;
				}
			}
		}
		return {
			floorFor: (genre) =>
				(genre ? (floors.get(genre) ?? globalFloor) : globalFloor) ?? null,
			hasDataset: week !== null,
			source,
			values,
			week,
		};
	}

	/** Weekly Apple popularity points for one term (oldest week first). */
	static async trend(country: string, term: string) {
		return db
			.select({
				genre: appleTopTerms.genre,
				popularity: appleTopTerms.popularity,
				rankInGenre: appleTopTerms.rankInGenre,
				week: appleTopTerms.week,
			})
			.from(appleTopTerms)
			.where(
				and(
					eq(appleTopTerms.country, country.toLowerCase()),
					eq(appleTopTerms.term, term.toLowerCase().trim()),
				),
			)
			.orderBy(appleTopTerms.week, desc(appleTopTerms.popularity));
	}

	/** Biggest popularity movers between the two newest stored weeks. */
	static async movers(country: string, genre?: string, limit = 10) {
		const cc = country.toLowerCase();
		const weeks = await db
			.selectDistinct({ week: appleTopTerms.week })
			.from(appleTopTerms)
			.where(eq(appleTopTerms.country, cc))
			.orderBy(desc(appleTopTerms.week))
			.limit(2);
		if (weeks.length < 2)
			return { movers: [], weeks: weeks.map((w) => w.week) };
		const [current, previous] = [weeks[0].week, weeks[1].week];
		const conditions = [
			eq(appleTopTerms.country, cc),
			inArray(appleTopTerms.week, [current, previous]),
		];
		if (genre) conditions.push(eq(appleTopTerms.genre, genre));
		const rows = await db
			.select({
				genre: appleTopTerms.genre,
				popularity: appleTopTerms.popularity,
				term: appleTopTerms.term,
				week: appleTopTerms.week,
			})
			.from(appleTopTerms)
			.where(and(...conditions));
		const byTerm = new Map<
			string,
			{ current?: number; genre: string; previous?: number }
		>();
		for (const row of rows) {
			const entry = byTerm.get(row.term) ?? { genre: row.genre };
			if (row.week === current) {
				entry.current = Math.max(entry.current ?? 0, row.popularity);
			} else {
				entry.previous = Math.max(entry.previous ?? 0, row.popularity);
			}
			byTerm.set(row.term, entry);
		}
		const movers = [...byTerm.entries()]
			.filter(
				(
					pair,
				): pair is [
					string,
					{ current: number; genre: string; previous: number },
				] => pair[1].current !== undefined && pair[1].previous !== undefined,
			)
			.map(([term, entry]) => ({
				current: entry.current,
				delta: entry.current - entry.previous,
				genre: entry.genre,
				previous: entry.previous,
				term,
			}))
			.filter((m) => m.delta !== 0)
			.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
			.slice(0, limit);
		return { movers, weeks: [current, previous] };
	}

	// ── Impression share ────────────────────────────────────────────────

	/**
	 * Sync impression share for one app (last 4 completed weeks). Apple only
	 * reports terms where the app's own ads served, so zero rows is a
	 * normal, successful outcome.
	 */
	static async syncImpressions(workspaceId: string, appId: string) {
		const creds = await AppleAdsService.getCredentials(workspaceId);
		if (!creds) {
			buildError("badRequest", {
				info: "Apple Ads is not connected for this workspace.",
			});
		}
		const [app] = await db
			.select({ externalId: apps.externalId, platform: apps.platform })
			.from(apps)
			.where(eq(apps.id, appId))
			.limit(1);
		if (!app?.externalId || app.platform !== "ios") {
			buildError("badRequest", {
				info: "Impression share needs an iOS app with a store id.",
			});
		}
		const latest = latestAvailableWeek();
		const start = new Date(`${latest}T00:00:00Z`);
		start.setUTCDate(start.getUTCDate() - 7 * (IMPRESSION_WEEKS_PER_QUERY - 1));
		const rows = await queryImpressionShare(
			creds,
			app.externalId,
			weekStartSunday(start),
			IMPRESSION_WEEKS_PER_QUERY,
		);
		let stored = 0;
		for (const row of rows) {
			const term = row.searchTerm;
			const country = row.countryOrRegion;
			const weekRaw = row.week;
			const low = row.lowImpressionShare;
			const high = row.highImpressionShare;
			if (
				typeof term !== "string" ||
				!term.trim() ||
				typeof country !== "string" ||
				!country ||
				typeof weekRaw !== "string" ||
				typeof low !== "number" ||
				low < 0 ||
				low > 1 ||
				typeof high !== "number" ||
				high < 0 ||
				high > 1
			) {
				continue;
			}
			await db
				.insert(appleImpressionShares)
				.values({
					appId,
					country: country.toLowerCase().slice(0, 2),
					highShare: high,
					lowShare: low,
					popularityTier:
						typeof row.searchPopularity1to5 === "number"
							? row.searchPopularity1to5
							: null,
					rank: typeof row.rank === "number" ? row.rank : null,
					searchTerm: term.toLowerCase().trim().slice(0, 200),
					week: weekRaw.slice(0, 10),
				})
				.onConflictDoUpdate({
					set: {
						highShare: high,
						lowShare: low,
						updatedAt: new Date(),
					},
					target: [
						appleImpressionShares.appId,
						appleImpressionShares.country,
						appleImpressionShares.searchTerm,
						appleImpressionShares.week,
					],
				});
			stored++;
		}
		return { stored };
	}

	// ── Scheduled sync ──────────────────────────────────────────────────

	/** Workspaces with Apple Ads credentials configured. */
	static async listConnectedWorkspaceIds(): Promise<string[]> {
		const rows = await db
			.select({ workspaceId: settings.workspaceId })
			.from(settings)
			.where(eq(settings.key, APPLE_ADS_SETTING_KEYS.clientId));
		return rows.map((r) => r.workspaceId);
	}

	/** Countries this workspace scored keywords in recently (max 5). */
	static async countriesInUse(workspaceId: string): Promise<string[]> {
		const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
			.toISOString()
			.slice(0, 10);
		const rows = await db
			.selectDistinct({ country: keywordScoreSnapshots.country })
			.from(keywordScoreSnapshots)
			.where(
				and(
					eq(keywordScoreSnapshots.workspaceId, workspaceId),
					gte(keywordScoreSnapshots.day, cutoff),
				),
			)
			.limit(5);
		const countries = rows.map((r) => r.country);
		return countries.length ? countries : ["us"];
	}

	/**
	 * Keep every connected workspace's in-use countries on the newest
	 * completed week. syncCountry no-ops when the week is already active,
	 * so a daily invocation is cheap outside the Monday rollover.
	 */
	static async runScheduledSync(): Promise<void> {
		const workspaceIds = await AppleAdsService.listConnectedWorkspaceIds();
		for (const workspaceId of workspaceIds) {
			const countries = await AppleAdsService.countriesInUse(workspaceId);
			for (const country of countries) {
				try {
					await AppleAdsService.syncCountry(workspaceId, country);
				} catch (err) {
					log.error(
						{ country, err, workspaceId },
						"Scheduled Apple sync failed",
					);
				}
			}
		}
	}

	static async getImpressions(appId: string) {
		return db
			.select()
			.from(appleImpressionShares)
			.where(eq(appleImpressionShares.appId, appId))
			.orderBy(
				desc(appleImpressionShares.week),
				desc(appleImpressionShares.highShare),
			);
	}
}

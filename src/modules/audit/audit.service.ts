import { and, eq } from "drizzle-orm";
import { AppsService } from "@/modules/apps/apps.service";
import {
	appstoreMeta,
	isoForListingLanguage,
} from "@/modules/research/appstore.client";
import {
	type AuditApp,
	type AuditResult,
	buildAudit,
	extractCompetitorCandidates,
	extractKeywordCandidates,
	inGenre,
} from "@/modules/research/listing-audit";
import {
	buildSuggestions,
	type Suggestion,
} from "@/modules/research/listing-suggestions";
import { langFor } from "@/modules/research/playstore.client";
import { ResearchService } from "@/modules/research/research.service";
import type { KeywordScore } from "@/modules/research/scoring-types";
import { TrackingService } from "@/modules/tracking/tracking.service";
import { db } from "@/utils/db";
import { appAudits, apps, assets, listings, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import type { AppAuditReport, AppAuditResponse } from "./audit.types";

const log = createLogger("audit-service");

const DEFAULT_COUNTRY = "us";
/** ResearchService.keywordScores caps the batch; asking for more just wastes calls. */
const MAX_AUDIT_KEYWORDS = 10;
/**
 * Second pass over terms taken from rival titles. Each one costs two live
 * store calls, so this stays small: the point is to break out of the app's
 * own vocabulary, not to enumerate the category.
 */
const MAX_COMPETITOR_KEYWORDS = 6;
/** How long a stored report stays fresh before a background refresh. */
const FRESH_FOR_MS = 12 * 60 * 60 * 1000;
/** A run that has not finished in this long is treated as dead, not running. */
const RUN_TIMEOUT_MS = 5 * 60 * 1000;
/** Terms seeded into nightly tracking after the first audit of a country. */
const AUTO_TRACK_LIMIT = 15;

interface AppRow {
	externalId: string;
	platform: string;
	primaryCategory: string | null;
	rawData: Record<string, unknown> | null;
	connectionMode: string | null;
}

export class AuditService {
	/**
	 * Cache-first read. Computing an audit costs a minute of live store calls,
	 * so the panel never waits on it: a stored report comes back immediately
	 * and a refresh runs in the background. A first-ever read returns
	 * "measuring" - never a zero score, never a hung request.
	 */
	static async read(
		appId: string,
		workspaceId: string,
		options: { country?: string; language?: string; refresh?: boolean } = {},
	): Promise<AppAuditResponse> {
		const [appRow] = await db
			.select({ rawData: apps.rawData })
			.from(apps)
			.where(eq(apps.id, appId))
			.limit(1);
		if (appRow && AppsService.isLocal(appRow)) {
			return { refreshing: false, report: null, status: "not-in-store" };
		}

		const country = await AuditService.resolveCountry(appId, options.country);
		const [row] = await db
			.select()
			.from(appAudits)
			.where(and(eq(appAudits.appId, appId), eq(appAudits.country, country)))
			.limit(1);

		const running =
			row?.status === "measuring" &&
			!!row.startedAt &&
			Date.now() - row.startedAt.getTime() < RUN_TIMEOUT_MS;
		if (running) {
			return {
				refreshing: true,
				report: row.report ?? null,
				status: "measuring",
			};
		}

		const report = row?.report ?? null;
		const hasReport = !!report && row?.status !== "measuring";
		const stale =
			!row ||
			options.refresh === true ||
			Date.now() - row.updatedAt.getTime() > FRESH_FOR_MS;

		if (stale) {
			await AuditService.markRunning(appId, country, row?.id);
			// Deliberately not awaited: the caller gets whatever we already have.
			void AuditService.refresh(appId, workspaceId, country, options.language);
		}

		if (!hasReport) {
			return { refreshing: true, report: null, status: "measuring" };
		}
		return {
			error: row?.status === "failed" ? "last-run-failed" : undefined,
			refreshing: stale,
			report,
			status: "ready",
		};
	}

	/**
	 * Accept-or-reject text proposals for one language, derived from the
	 * stored audit and the current draft (or the store text when there is no
	 * draft). Nothing here writes anything - accepting is the ordinary
	 * listing update, so it lands in the draft and shows up in the publish
	 * diff like any other edit.
	 */
	static async suggestions(
		appId: string,
		language?: string,
	): Promise<{
		language: string | null;
		source: "draft" | "remote" | null;
		status: "ready" | "no-audit";
		suggestions: Suggestion[];
	}> {
		const [row] = await db
			.select()
			.from(appAudits)
			.where(and(eq(appAudits.appId, appId), eq(appAudits.status, "ready")))
			.limit(1);
		const report = row?.report ?? null;
		if (!report) {
			return {
				language: null,
				source: null,
				status: "no-audit",
				suggestions: [],
			};
		}

		const [appRow] = await db
			.select({ platform: apps.platform })
			.from(apps)
			.where(eq(apps.id, appId))
			.limit(1);
		const wanted = language ?? report.language;
		const rows = await db
			.select()
			.from(listings)
			.where(and(eq(listings.appId, appId), eq(listings.language, wanted)));
		const listing =
			rows.find((r) => r.source === "draft") ??
			rows.find((r) => r.source === "remote") ??
			null;
		if (!listing) {
			return {
				language: wanted,
				source: null,
				status: "ready",
				suggestions: [],
			};
		}

		const suggestions = buildSuggestions(
			{
				description: listing.fullDesc ?? undefined,
				keywords: listing.keywords ?? undefined,
				language: wanted,
				name: listing.title ?? report.store.themes[0] ?? "",
				platform: appRow?.platform === "android" ? "android" : "ios",
				shortDesc: listing.shortDesc ?? undefined,
			},
			report.keywords,
			report.recommendable ?? [],
			report.store.issues,
		);
		return {
			language: wanted,
			source: listing.source === "draft" ? "draft" : "remote",
			status: "ready",
			suggestions,
		};
	}

	/**
	 * First audit for a country -> track its recommendable terms plus anything
	 * the app already ranks for, and switch nightly checks on. Only when the
	 * app tracks nothing yet: a hand-curated list is never overwritten.
	 */
	private static async autoTrack(
		appId: string,
		workspaceId: string,
		country: string,
		report: AppAuditReport,
	): Promise<void> {
		const existing = await TrackingService.getKeywords(appId);
		if (
			existing.some((k) => k.country.toLowerCase() === country.toLowerCase())
		) {
			return;
		}
		const allowed = new Set(report.recommendable.map((k) => k.toLowerCase()));
		const picked = report.keywords
			.filter((k) => !k.error)
			.filter((k) => allowed.has(k.keyword.toLowerCase()) || k.appRank != null)
			.sort((a, b) => b.opportunity - a.opportunity)
			.map((k) => k.keyword)
			.slice(0, AUTO_TRACK_LIMIT);
		if (picked.length === 0) return;
		await TrackingService.addKeywords(appId, country.toUpperCase(), picked);
		await TrackingService.updateConfig(appId, workspaceId, {
			rankTrackingEnabled: true,
		});
		log.info({ appId, count: picked.length, country }, "Auto-tracking seeded");
	}

	private static async resolveCountry(
		appId: string,
		override?: string,
	): Promise<string> {
		if (override) return override.toLowerCase();
		const [row] = await db
			.select({ rawData: apps.rawData })
			.from(apps)
			.where(eq(apps.id, appId))
			.limit(1);
		const raw = row?.rawData as Record<string, unknown> | null;
		return (
			(raw?.publicCountry as string | undefined) ?? DEFAULT_COUNTRY
		).toLowerCase();
	}

	private static async markRunning(
		appId: string,
		country: string,
		existingId?: string,
	): Promise<void> {
		if (existingId) {
			await db
				.update(appAudits)
				.set({ startedAt: new Date(), status: "measuring" })
				.where(eq(appAudits.id, existingId));
			return;
		}
		await db
			.insert(appAudits)
			.values({
				appId,
				country,
				startedAt: new Date(),
				status: "measuring",
				storeScore: 0,
			})
			.onConflictDoNothing();
	}

	/** Runs the real computation and stores it. Never throws at the caller. */
	private static async refresh(
		appId: string,
		workspaceId: string,
		country: string,
		language?: string,
	): Promise<void> {
		try {
			const report = await AuditService.forApp(appId, workspaceId, {
				country,
				language,
			});
			await db
				.insert(appAudits)
				.values({
					appId,
					country,
					draftScore: report.draft?.asoScore ?? null,
					report,
					status: "ready",
					storeScore: report.store.asoScore,
				})
				.onConflictDoUpdate({
					set: {
						draftScore: report.draft?.asoScore ?? null,
						report,
						startedAt: null,
						status: "ready",
						storeScore: report.store.asoScore,
						updatedAt: new Date(),
					},
					target: [appAudits.appId, appAudits.country],
				});
			// Nightly positions should start without anyone clicking "track":
			// the audit already knows which terms matter, so seed them once.
			await AuditService.autoTrack(appId, workspaceId, country, report).catch(
				(err) => log.warn({ appId, err }, "Auto-tracking after audit failed"),
			);
		} catch (error) {
			log.error({ appId, country, err: error }, "App audit failed");
			// Keep whatever report is already stored: a failed refresh must not
			// wipe a good number off the user's screen.
			await db
				.update(appAudits)
				.set({ startedAt: null, status: "failed" })
				.where(and(eq(appAudits.appId, appId), eq(appAudits.country, country)));
		}
	}

	/**
	 * Two scores for one app: what the store currently serves, and what your
	 * draft would score if published. Both run the same rules engine the free
	 * browser check-up runs, so a number never means two different things.
	 */
	static async forApp(
		appId: string,
		workspaceId: string,
		options: { country?: string; language?: string } = {},
	): Promise<AppAuditReport> {
		const [row] = await db
			.select({
				connectionMode: stores.connectionMode,
				externalId: apps.externalId,
				platform: apps.platform,
				primaryCategory: apps.primaryCategory,
				rawData: apps.rawData,
			})
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(eq(apps.id, appId))
			.limit(1);

		if (!row) buildError("notFound", { info: "App not found" });
		const app = row as AppRow;

		// Nothing is published, so there is no store listing to measure. Saying
		// "0/100" or inventing a score would be a lie; the panel shows the
		// write-your-listing path instead.
		if (AppsService.isLocal(app)) {
			buildError("badRequest", {
				info: "This app is not in a store yet, so there is no listing to score. Write your title and description first - the audit starts working the moment it is live.",
			});
		}

		if (app.platform !== "ios") {
			buildError("badRequest", {
				info: "Keyword difficulty is App Store only, so the audit currently runs for iOS apps. Google Play support is tracked separately.",
			});
		}

		const country =
			options.country ??
			(app.rawData?.publicCountry as string | undefined) ??
			DEFAULT_COUNTRY;

		// The store score must come from what the store actually serves, not
		// from our last sync - otherwise "in the store" silently means "in our
		// database", and the two numbers stop meaning different things. Ask in
		// the language of the market being audited: a PL storefront serving a
		// Polish listing must be scored on the Polish text, not on the English
		// fallback the API returns when no language is requested.
		const auditLanguage = options.language ?? langFor(country);
		const iso = isoForListingLanguage(auditLanguage);
		const meta = await appstoreMeta(app.externalId, country, iso ?? undefined);

		const storeApp: AuditApp = {
			country,
			description: meta.description ?? "",
			genre: meta.genre ?? app.primaryCategory ?? "",
			languages: meta.languages,
			name: meta.title,
			rating: meta.rating,
			ratingsCount: meta.ratingsCount,
			// The preview list is capped at 6 for display; the audit needs the
			// real total or "only N screenshots" lies about every rich listing.
			screenshots: meta.screenshotCount ?? meta.screenshots?.length ?? 0,
			updated: meta.lastUpdate,
		};

		const candidates = extractKeywordCandidates(storeApp).slice(
			0,
			MAX_AUDIT_KEYWORDS,
		);
		const own = candidates.length
			? await ResearchService.keywordScores(
					candidates,
					country,
					app.externalId,
					workspaceId,
				)
			: [];

		// Pass two: the words your rivals use. Without this the audit can only
		// ever suggest terms already written in your own listing, which is
		// exactly the blind spot that lets an app miss its category's name.
		const rivals = own.flatMap((score) => score.competitors ?? []);
		const alreadyScored = own.map((s) => s.keyword);
		// Mine every rival so coverage stays wide (you want to know that a term
		// is contested), but remember which terms came from apps in your own
		// category - only those are safe to recommend.
		const fromRivals = extractCompetitorCandidates(
			rivals,
			storeApp.name,
			alreadyScored,
		).slice(0, MAX_COMPETITOR_KEYWORDS);
		const fromPeers = extractCompetitorCandidates(
			rivals.filter(inGenre(storeApp.genre)),
			storeApp.name,
			alreadyScored,
		);
		const competitorScores = fromRivals.length
			? await ResearchService.keywordScores(
					fromRivals,
					country,
					app.externalId,
					workspaceId,
				)
			: [];
		const keywords = [...own, ...competitorScores];
		// Your own listing's words are always fair game to suggest; a rival's
		// only when that rival is in your category.
		const recommendable = [...candidates, ...fromPeers];

		const store = buildAudit(storeApp, keywords, { recommendable });
		const draft = await AuditService.draftAudit(
			appId,
			storeApp,
			keywords,
			auditLanguage,
			recommendable,
		);

		log.info(
			{
				appId,
				country,
				draftScore: draft?.asoScore,
				storeScore: store.asoScore,
			},
			"App audit computed",
		);

		return {
			appId,
			country,
			draft: draft
				? {
						asoScore: draft.asoScore,
						changedFields: draft.changedFields,
						issues: draft.issues,
						strengths: draft.strengths,
						themes: draft.themes,
					}
				: null,
			keywords,
			// The report speaks the language of the market it measured. Falling
			// back to en-US here would hand Polish keyword proposals to the
			// English listing.
			language: draft?.language ?? auditLanguage,
			measuredAt: new Date().toISOString(),
			recommendable,
			store,
		};
	}

	/**
	 * Re-runs the same rules against the unpublished draft. Screenshot count,
	 * ratings and freshness come from the store either way - a draft cannot
	 * change them, and pretending otherwise would inflate the number.
	 */
	private static async draftAudit(
		appId: string,
		storeApp: AuditApp,
		keywords: KeywordScore[],
		language?: string,
		recommendable?: string[],
	): Promise<
		(AuditResult & { changedFields: string[]; language: string }) | null
	> {
		const draftRows = await db
			.select()
			.from(listings)
			.where(and(eq(listings.appId, appId), eq(listings.source, "draft")));

		if (draftRows.length === 0) return null;
		const draftRow = language
			? (draftRows.find((r) => r.language === language) ?? draftRows[0])
			: draftRows[0];

		const changedFields: string[] = [];
		if (draftRow.title && draftRow.title !== storeApp.name) {
			changedFields.push("title");
		}
		if (draftRow.fullDesc && draftRow.fullDesc !== storeApp.description) {
			changedFields.push("description");
		}
		if (draftRow.shortDesc) changedFields.push("subtitle");
		if (draftRow.keywords) changedFields.push("keywords");

		const draftApp: AuditApp = {
			...storeApp,
			description: draftRow.fullDesc ?? storeApp.description,
			name: draftRow.title ?? storeApp.name,
			subtitle: draftRow.shortDesc ?? undefined,
		};

		return {
			...buildAudit(draftApp, keywords, { recommendable }),
			changedFields,
			language: draftRow.language,
		};
	}

	/** Screenshot count AppBoard holds locally, used by the panel's fix queue. */
	static async localScreenshotCount(appId: string): Promise<number> {
		const rows = await db
			.select({ id: assets.id })
			.from(assets)
			.where(and(eq(assets.appId, appId), eq(assets.assetType, "screenshot")));
		return rows.length;
	}
}

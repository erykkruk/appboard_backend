import { and, desc, eq, isNull } from "drizzle-orm";
import { AppsService } from "@/modules/apps/apps.service";
import { db } from "@/utils/db";
import { researchRuns } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import { ResearchAiService } from "./research.ai";
import { ResearchService } from "./research.service";
import {
	platformToStore,
	type ResearchRunReport,
	type ResearchStore,
} from "./research.types";

const log = createLogger("research-runs");

const KEYWORD_SAMPLE_LIMIT = 15;

export interface SaveRunInput {
	appId?: string | null;
	country?: string;
	externalId?: string;
	kind?: "manual" | "scheduled";
	report: ResearchRunReport;
	store?: ResearchStore;
	summary?: string;
	title?: string;
}

// Columns returned in list views — the full `report` jsonb is omitted to keep
// list payloads small; fetch a single run to get it.
const listColumns = {
	appId: researchRuns.appId,
	country: researchRuns.country,
	createdAt: researchRuns.createdAt,
	externalId: researchRuns.externalId,
	id: researchRuns.id,
	kind: researchRuns.kind,
	store: researchRuns.store,
	summary: researchRuns.summary,
	title: researchRuns.title,
};

export class ResearchRunsService {
	static async saveRun(workspaceId: string, input: SaveRunInput) {
		const [run] = await db
			.insert(researchRuns)
			.values({
				appId: input.appId ?? null,
				country: input.country ?? input.report.meta.country,
				externalId: input.externalId ?? input.report.meta.id,
				kind: input.kind ?? "manual",
				report: input.report,
				store: input.store ?? input.report.meta.store,
				summary: input.summary ?? input.report.analysis?.summary ?? null,
				title: input.title ?? input.report.meta.title,
				workspaceId,
			})
			.returning();
		return run;
	}

	static async listRuns(workspaceId: string, filters?: { appId?: string }) {
		const conditions = [eq(researchRuns.workspaceId, workspaceId)];
		if (filters?.appId) {
			conditions.push(eq(researchRuns.appId, filters.appId));
		}
		return db
			.select(listColumns)
			.from(researchRuns)
			.where(and(...conditions))
			.orderBy(desc(researchRuns.createdAt));
	}

	/** Workspace-level runs saved from the standalone tool (appId IS NULL). */
	static async listStandaloneRuns(workspaceId: string) {
		return db
			.select(listColumns)
			.from(researchRuns)
			.where(
				and(
					eq(researchRuns.workspaceId, workspaceId),
					isNull(researchRuns.appId),
				),
			)
			.orderBy(desc(researchRuns.createdAt));
	}

	static async getRun(workspaceId: string, id: string, appId?: string) {
		const conditions = [
			eq(researchRuns.id, id),
			eq(researchRuns.workspaceId, workspaceId),
		];
		if (appId) conditions.push(eq(researchRuns.appId, appId));
		const [run] = await db
			.select()
			.from(researchRuns)
			.where(and(...conditions))
			.limit(1);
		if (!run) buildError("notFound", { info: "Research run not found" });
		return run;
	}

	static async deleteRun(workspaceId: string, id: string, appId?: string) {
		const conditions = [
			eq(researchRuns.id, id),
			eq(researchRuns.workspaceId, workspaceId),
		];
		if (appId) conditions.push(eq(researchRuns.appId, appId));
		const [deleted] = await db
			.delete(researchRuns)
			.where(and(...conditions))
			.returning({ id: researchRuns.id });
		if (!deleted) buildError("notFound", { info: "Research run not found" });
		return { id: deleted.id, success: true };
	}

	/**
	 * Run a full research pass against a connected app and persist it. Scrapes
	 * store metadata + reviews, computes heuristics, runs AI analysis
	 * (best-effort — skipped if no OpenRouter key), checks positions for the
	 * provided keywords, then saves the run tied to the app.
	 */
	static async runForApp(
		appId: string,
		workspaceId: string,
		options: {
			country: string;
			deep?: boolean;
			keywords?: string[];
			kind?: "manual" | "scheduled";
		},
	) {
		const app = await AppsService.findOne(workspaceId, appId);
		const store = platformToStore(app.platform);
		const { country, deep } = options;

		const { heuristics, meta, reviews } = await ResearchService.scrape(
			{ country, id: app.externalId, store },
			deep,
		);

		let analysis: ResearchRunReport["analysis"];
		if (reviews.length) {
			try {
				const result = await ResearchAiService.analyzeReviews(
					workspaceId,
					[meta],
					reviews,
					{ deep },
				);
				analysis = result.analysis;
			} catch (err) {
				// AI is best-effort: a missing key or model error must not fail the
				// whole run — the heuristics + keyword positions are still useful.
				log.info({ appId, err }, "AI analysis skipped for research run");
			}
		}

		let keywords: ResearchRunReport["keywords"];
		const trimmed = (options.keywords ?? [])
			.map((k) => k.trim())
			.filter(Boolean)
			.slice(0, KEYWORD_SAMPLE_LIMIT);
		if (trimmed.length) {
			keywords = await ResearchService.keywordPositions(
				trimmed,
				country,
				store === "appstore" ? app.externalId : undefined,
				store === "playstore" ? app.externalId : undefined,
			);
		}

		const report: ResearchRunReport = {
			analysis,
			deep,
			heuristics,
			keywords,
			meta,
			reviewsCount: reviews.length,
		};

		return ResearchRunsService.saveRun(workspaceId, {
			appId,
			country,
			externalId: app.externalId,
			kind: options.kind ?? "manual",
			report,
			store,
			summary: analysis?.summary,
			title: app.name,
		});
	}
}

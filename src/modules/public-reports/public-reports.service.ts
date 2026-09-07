import { eq, lt } from "drizzle-orm";
import { db } from "@/utils/db";
import {
	publicAsoReports,
	publicKeywordObservations,
	publicReportShares,
} from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("public-reports");

const VALID_CLASSIFICATIONS = new Set([
	"sweet-spot",
	"good-target",
	"hidden-gem",
	"moderate",
	"high-competition",
	"low-volume",
	"avoid",
	"unknown",
]);

/** Free tools whose finished report can be turned into a link. */
export const SHARE_TOOLS = ["aso-check", "keyword-check"] as const;
export type ShareTool = (typeof SHARE_TOOLS)[number];

/** A shared link stops answering after this; the row is dropped by the scheduler. */
const SHARE_RETENTION_DAYS = 365;

export interface PublicShareInput {
	appName?: string;
	/** "all" for a multi-market report, otherwise the storefront code. */
	country: string;
	payload: Record<string, unknown>;
	store?: "appstore" | "playstore";
	tool: ShareTool;
	trackId?: string;
}

export interface PublicReportInput {
	appName?: string;
	asoScore?: number;
	country: string;
	store?: "appstore" | "playstore";
	keywords: Array<{
		appRank?: number | null;
		classification: string;
		difficulty: number;
		keyword: string;
		opportunity: number;
		popularity?: number | null;
	}>;
	trackId?: string;
}

/**
 * Persist one anonymous check-up: a report row plus one observation per
 * keyword (deduped, normalized). The crowd observations table becomes a
 * growing keyword-score dataset - kept strictly separate from workspace
 * data because the values are client-computed and unverifiable.
 */
export class PublicReportsService {
	static async store(input: PublicReportInput, ipHash: string) {
		const day = new Date().toISOString().slice(0, 10);
		const seen = new Set<string>();
		const keywords = input.keywords.filter((k) => {
			const norm = k.keyword.trim().toLowerCase();
			if (!norm || seen.has(norm)) return false;
			seen.add(norm);
			if (!VALID_CLASSIFICATIONS.has(k.classification)) return false;
			return true;
		});
		if (!keywords.length) {
			return { keywordsStored: 0, success: true };
		}

		const [report] = await db
			.insert(publicAsoReports)
			.values({
				appName: input.appName?.slice(0, 255) ?? null,
				asoScore: input.asoScore ?? null,
				country: input.country.toLowerCase(),
				ipHash,
				keywordCount: keywords.length,
				store: input.store === "playstore" ? "playstore" : "appstore",
				trackId: input.trackId?.slice(0, 255) ?? null,
			})
			.returning({ id: publicAsoReports.id });

		await db.insert(publicKeywordObservations).values(
			keywords.map((k) => ({
				appRank: k.appRank ?? null,
				classification: k.classification,
				country: input.country.toLowerCase(),
				day,
				difficulty: Math.round(k.difficulty),
				keyword: k.keyword.trim().toLowerCase().slice(0, 255),
				opportunity: Math.round(k.opportunity),
				popularity: k.popularity == null ? null : Math.round(k.popularity),
				reportId: report.id,
			})),
		);

		log.info(
			{
				country: input.country,
				keywords: keywords.length,
				trackId: input.trackId,
			},
			"Public ASO check-up stored",
		);
		return { keywordsStored: keywords.length, success: true };
	}

	/**
	 * Keep one finished report so its link can be opened by anyone. The
	 * payload is the browser's own snapshot (untrusted): stored as-is and
	 * rendered only through the panel's sanitizer.
	 */
	static async share(input: PublicShareInput, ipHash: string) {
		const [row] = await db
			.insert(publicReportShares)
			.values({
				appName: input.appName?.slice(0, 255) ?? null,
				country: input.country.toLowerCase(),
				ipHash,
				payload: input.payload,
				store: input.store === "playstore" ? "playstore" : "appstore",
				tool: input.tool,
				trackId: input.trackId?.slice(0, 255) ?? null,
			})
			.returning({ id: publicReportShares.id });
		log.info(
			{ country: input.country, id: row.id, tool: input.tool },
			"Public report shared",
		);
		return { id: row.id };
	}

	static async getShare(id: string) {
		const [row] = await db
			.select({
				appName: publicReportShares.appName,
				country: publicReportShares.country,
				createdAt: publicReportShares.createdAt,
				id: publicReportShares.id,
				payload: publicReportShares.payload,
				store: publicReportShares.store,
				tool: publicReportShares.tool,
				trackId: publicReportShares.trackId,
			})
			.from(publicReportShares)
			.where(eq(publicReportShares.id, id))
			.limit(1);
		if (!row) {
			buildError("notFound", {
				info: "This shared report does not exist or has expired.",
			});
		}
		return row;
	}

	/** Drop shared reports older than the retention window. */
	static async cleanupShares(): Promise<number> {
		const cutoff = new Date(Date.now() - SHARE_RETENTION_DAYS * 86_400_000);
		const removed = await db
			.delete(publicReportShares)
			.where(lt(publicReportShares.createdAt, cutoff))
			.returning({ id: publicReportShares.id });
		if (removed.length) {
			log.info({ removed: removed.length }, "Shared report cleanup");
		}
		return removed.length;
	}
}

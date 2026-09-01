import { db } from "@/utils/db";
import { publicAsoReports, publicKeywordObservations } from "@/utils/db/schema";
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
}

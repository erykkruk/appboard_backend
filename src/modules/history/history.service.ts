import { and, desc, eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { listingHistory, listings } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

export class HistoryService {
	static async getHistory(
		appId: string,
		filters?: { field?: string; language?: string },
	) {
		const conditions = [eq(listingHistory.appId, appId)];

		if (filters?.language) {
			conditions.push(eq(listingHistory.language, filters.language));
		}
		if (filters?.field) {
			conditions.push(eq(listingHistory.field, filters.field));
		}

		return db
			.select()
			.from(listingHistory)
			.where(and(...conditions))
			.orderBy(desc(listingHistory.createdAt));
	}

	static async rollback(appId: string, historyId: string) {
		const [entry] = await db
			.select()
			.from(listingHistory)
			.where(
				and(eq(listingHistory.id, historyId), eq(listingHistory.appId, appId)),
			)
			.limit(1);

		if (!entry) {
			buildError("notFound", { info: "History entry not found" });
			throw new Error("unreachable");
		}

		// Find the draft listing for this language
		const [draft] = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, appId),
					eq(listings.language, entry.language),
					eq(listings.source, "draft"),
				),
			)
			.limit(1);

		if (draft) {
			await db
				.update(listings)
				.set({ [entry.field]: entry.oldValue, isDirty: true })
				.where(eq(listings.id, draft.id));
		} else {
			// Create a draft with the rolled-back value
			const [remote] = await db
				.select()
				.from(listings)
				.where(
					and(
						eq(listings.appId, appId),
						eq(listings.language, entry.language),
						eq(listings.source, "remote"),
					),
				)
				.limit(1);

			const baseData = remote
				? {
						fullDesc: remote.fullDesc,
						keywords: remote.keywords,
						marketingUrl: remote.marketingUrl,
						privacyUrl: remote.privacyUrl,
						promoText: remote.promoText,
						shortDesc: remote.shortDesc,
						supportUrl: remote.supportUrl,
						title: remote.title,
						whatsNew: remote.whatsNew,
					}
				: {};

			await db.insert(listings).values({
				...baseData,
				[entry.field]: entry.oldValue,
				appId,
				isDirty: true,
				language: entry.language,
				source: "draft",
			});
		}

		return { success: true };
	}
}

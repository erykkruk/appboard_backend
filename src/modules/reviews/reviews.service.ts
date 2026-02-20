import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { StoreType } from "@/config/const";
import { createProvider } from "@/providers";
import { decrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { apps, reviews, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("reviews-service");

export class ReviewsService {
	static async syncFromStore(appId: string) {
		const app = await ReviewsService.getAppWithStore(appId);
		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const provider = createProvider(app.store.type as StoreType, credentials);

		const fetched = await provider.fetchReviews(app.externalId);

		for (const review of fetched) {
			const existing = await db
				.select()
				.from(reviews)
				.where(eq(reviews.externalId, review.externalId))
				.limit(1);

			if (existing.length > 0) {
				await db
					.update(reviews)
					.set({
						body: review.body,
						rating: review.rating,
						repliedAt: review.repliedAt,
						replyText: review.replyText,
						syncedAt: new Date(),
						title: review.title,
					})
					.where(eq(reviews.id, existing[0].id));
			} else {
				await db.insert(reviews).values({
					appId,
					appVersion: review.appVersion,
					authorName: review.authorName,
					body: review.body,
					device: review.device,
					externalId: review.externalId,
					language: review.language,
					osVersion: review.osVersion,
					rating: review.rating,
					repliedAt: review.repliedAt,
					replyText: review.replyText,
					reviewDate: review.reviewDate,
					storeType: app.store.type,
					syncedAt: new Date(),
					territory: review.territory,
					title: review.title,
				});
			}
		}

		log.info({ appId, count: fetched.length }, "Reviews synced from store");
		return { synced: fetched.length };
	}

	static async list(
		appId: string,
		filters?: {
			hasReply?: boolean;
			language?: string;
			rating?: number;
			storeType?: string;
		},
	) {
		const conditions = [eq(reviews.appId, appId)];

		if (filters?.rating) {
			conditions.push(eq(reviews.rating, filters.rating));
		}
		if (filters?.language) {
			conditions.push(eq(reviews.language, filters.language));
		}
		if (filters?.storeType) {
			conditions.push(eq(reviews.storeType, filters.storeType));
		}
		if (filters?.hasReply === true) {
			conditions.push(isNotNull(reviews.replyText));
		} else if (filters?.hasReply === false) {
			conditions.push(isNull(reviews.replyText));
		}

		return db
			.select()
			.from(reviews)
			.where(and(...conditions))
			.orderBy(reviews.reviewDate);
	}

	static async reply(appId: string, reviewId: string, text: string) {
		const [review] = await db
			.select()
			.from(reviews)
			.where(and(eq(reviews.id, reviewId), eq(reviews.appId, appId)))
			.limit(1);

		if (!review) {
			buildError("notFound", { info: "Review not found" });
			throw new Error("unreachable");
		}

		const app = await ReviewsService.getAppWithStore(appId);
		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const provider = createProvider(app.store.type as StoreType, credentials);

		await provider.replyToReview(app.externalId, review.externalId, text);

		await db
			.update(reviews)
			.set({ repliedAt: new Date(), replyText: text })
			.where(eq(reviews.id, reviewId));

		return { success: true };
	}

	static async getStats(appId: string) {
		const result = await db
			.select({
				avgRating: sql<number>`avg(${reviews.rating})::float`,
				count: sql<number>`count(*)::int`,
				rating: reviews.rating,
			})
			.from(reviews)
			.where(eq(reviews.appId, appId))
			.groupBy(reviews.rating);

		const totalReviews = result.reduce((sum, r) => sum + r.count, 0);
		const avgRating =
			totalReviews > 0
				? result.reduce((sum, r) => sum + r.rating * r.count, 0) / totalReviews
				: 0;

		const distribution: Record<number, number> = {
			1: 0,
			2: 0,
			3: 0,
			4: 0,
			5: 0,
		};
		for (const r of result) {
			distribution[r.rating] = r.count;
		}

		// Count reviews without a reply
		const [noReplyResult] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(reviews)
			.where(and(eq(reviews.appId, appId), isNull(reviews.replyText)));

		return {
			averageRating: Math.round(avgRating * 100) / 100,
			distribution,
			noReplyCount: noReplyResult?.count ?? 0,
			totalReviews,
		};
	}

	private static async getAppWithStore(appId: string) {
		const result = await db
			.select({ app: apps, store: stores })
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(eq(apps.id, appId))
			.limit(1);

		if (result.length === 0) {
			buildError("notFound", { info: "App not found" });
			throw new Error("unreachable");
		}

		return { ...result[0].app, store: result[0].store };
	}
}

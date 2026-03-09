import { eq } from "drizzle-orm";
import type { StoreType } from "@/config/const";
import { createProvider } from "@/providers";
import { decrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { appAgeRatings, apps, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import { computeAppleRating, getAgeRatingPreset } from "./age-rating.templates";

const log = createLogger("age-rating-service");

interface UpsertData {
	appleQuestionnaire?: Record<string, string>;
	googleQuestionnaire?: Record<string, string | boolean>;
	presetId: string;
}

export class AgeRatingService {
	static async get(appId: string) {
		const [rating] = await db
			.select()
			.from(appAgeRatings)
			.where(eq(appAgeRatings.appId, appId))
			.limit(1);

		return rating ?? null;
	}

	static async upsert(appId: string, data: UpsertData) {
		let appleQuestionnaire: Record<string, string> = {};
		let googleQuestionnaire: Record<string, string | boolean> = {};
		let appleRating: string;
		let googleRating: string;

		if (data.presetId !== "custom") {
			const preset = getAgeRatingPreset(data.presetId);
			if (preset) {
				appleQuestionnaire = preset.appleQuestionnaire;
				googleQuestionnaire = preset.googleQuestionnaire;
				appleRating = preset.appleRating;
				googleRating = preset.googleRating;
			} else {
				appleRating = "4+";
				googleRating = "EVERYONE";
			}
		} else {
			appleQuestionnaire = data.appleQuestionnaire ?? {};
			googleQuestionnaire = data.googleQuestionnaire ?? {};
			appleRating = computeAppleRating(appleQuestionnaire);
			googleRating = "EVERYONE";
		}

		const values = {
			appId,
			appleQuestionnaire,
			appleRating,
			googleQuestionnaire,
			googleRating,
			presetId: data.presetId,
		};

		const [result] = await db
			.insert(appAgeRatings)
			.values(values)
			.onConflictDoUpdate({
				set: {
					appleQuestionnaire: values.appleQuestionnaire,
					appleRating: values.appleRating,
					googleQuestionnaire: values.googleQuestionnaire,
					googleRating: values.googleRating,
					presetId: values.presetId,
					updatedAt: new Date(),
				},
				target: [appAgeRatings.appId],
			})
			.returning();

		log.info({ appId }, "Age rating upserted locally");
		return result;
	}

	static async publish(appId: string) {
		const rating = await AgeRatingService.get(appId);
		if (!rating) {
			log.info({ appId }, "No age rating configured — skipping publish");
			return { skipped: true, success: true };
		}

		await AgeRatingService.pushToStore(appId, rating.appleQuestionnaire);
		log.info({ appId }, "Age rating published to store");
		return { success: true };
	}

	private static async pushToStore(
		appId: string,
		appleQuestionnaire: Record<string, string>,
	) {
		const result = await db
			.select({ app: apps, store: stores })
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(eq(apps.id, appId))
			.limit(1);

		if (result.length === 0) {
			log.warn({ appId }, "App not found for age rating push");
			return;
		}

		const app = result[0].app;
		const store = result[0].store;

		if (!store.credentials) {
			log.warn({ appId }, "No store credentials for age rating push");
			return;
		}

		const credentials = JSON.parse(decrypt(store.credentials));
		const provider = createProvider(store.type as StoreType, credentials);

		await provider.updateAgeRating(app.externalId, appleQuestionnaire);
		log.info({ appId }, "Age rating pushed to store");
	}
}

import { eq } from "drizzle-orm";
import type { StoreType } from "@/config/const";
import { createProvider } from "@/providers";
import { decrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { appAgeRatings, apps, stores } from "@/utils/db/schema";
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

		// Push to App Store Connect
		let syncedToStore = false;
		let syncError: string | null = null;
		try {
			await AgeRatingService.pushToStore(appId, appleQuestionnaire);
			syncedToStore = true;
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			syncError = errMsg.includes("STATE_ERROR")
				? "NO_EDITABLE_VERSION"
				: "SYNC_FAILED";
			log.error(
				{ appId, err },
				"Failed to push age rating to store — saved locally only",
			);
		}

		return { ...result, syncError, syncedToStore };
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

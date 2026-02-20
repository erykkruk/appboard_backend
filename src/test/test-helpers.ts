import { Elysia } from "elysia";
import { aiController } from "@/modules/ai";
import { appsController } from "@/modules/apps";
import { assetsController } from "@/modules/assets";
import { historyController } from "@/modules/history";
import { listingsController } from "@/modules/listings";
import { reviewsController } from "@/modules/reviews";
import { settingsController } from "@/modules/settings";
import { storesController } from "@/modules/stores";
import { systemController } from "@/modules/system";
import { encrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import {
	apps,
	assets,
	listingHistory,
	listings,
	reviews,
	settings,
	stores,
} from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";

export function createTestApp() {
	return new Elysia()
		.use(errorHandler)
		.group("/api", (app) =>
			app
				.use(systemController)
				.use(storesController)
				.use(appsController)
				.use(listingsController)
				.use(historyController)
				.use(assetsController)
				.use(reviewsController)
				.use(aiController)
				.use(settingsController),
		);
}

export async function seedTestStore() {
	const creds = encrypt(JSON.stringify({ mock: true }));
	const [store] = await db
		.insert(stores)
		.values({
			credentials: creds,
			name: "Test Store",
			status: "connected",
			type: "google_play",
		})
		.returning();
	return store;
}

export async function seedTestApp(storeId: string) {
	const [app] = await db
		.insert(apps)
		.values({
			bundleId: "com.test.app",
			externalId: "com.example.taskmaster",
			iconUrl: "https://placehold.co/512x512",
			name: "Test App",
			platform: "android",
			storeId,
		})
		.returning();
	return app;
}

export async function cleanupTestData() {
	await db.delete(listingHistory);
	await db.delete(listings);
	await db.delete(assets);
	await db.delete(reviews);
	await db.delete(settings);
	await db.delete(apps);
	await db.delete(stores);
}

export async function request(
	app: ReturnType<typeof createTestApp>,
	method: string,
	path: string,
	body?: unknown,
) {
	const url = `http://localhost${path}`;
	const options: RequestInit = { method };
	if (body) {
		options.headers = { "Content-Type": "application/json" };
		options.body = JSON.stringify(body);
	}
	const response = await app.handle(new Request(url, options));
	const data = await response.json();
	return { data, status: response.status };
}

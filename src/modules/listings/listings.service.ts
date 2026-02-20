import { and, eq } from "drizzle-orm";
import type { StoreType } from "@/config/const";
import { createProvider } from "@/providers";
import { decrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { apps, listingHistory, listings, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("listings-service");

const LISTING_FIELDS = [
	"fullDesc",
	"keywords",
	"marketingUrl",
	"privacyUrl",
	"promoText",
	"shortDesc",
	"supportUrl",
	"title",
	"whatsNew",
] as const;

export class ListingsService {
	static async syncFromStore(appId: string) {
		const app = await ListingsService.getAppWithStore(appId);
		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const provider = createProvider(app.store.type as StoreType, credentials);

		const fetched = await provider.fetchListings(app.externalId);

		for (const listing of fetched) {
			await db
				.insert(listings)
				.values({
					appId,
					fullDesc: listing.fullDesc,
					keywords: listing.keywords,
					language: listing.language,
					marketingUrl: listing.marketingUrl,
					privacyUrl: listing.privacyUrl,
					promoText: listing.promoText,
					shortDesc: listing.shortDesc,
					source: "remote",
					supportUrl: listing.supportUrl,
					syncedAt: new Date(),
					title: listing.title,
					whatsNew: listing.whatsNew,
				})
				.onConflictDoUpdate({
					set: {
						fullDesc: listing.fullDesc,
						keywords: listing.keywords,
						marketingUrl: listing.marketingUrl,
						privacyUrl: listing.privacyUrl,
						promoText: listing.promoText,
						shortDesc: listing.shortDesc,
						supportUrl: listing.supportUrl,
						syncedAt: new Date(),
						title: listing.title,
						whatsNew: listing.whatsNew,
					},
					target: [listings.appId, listings.language, listings.source],
				});
		}

		log.info({ appId, count: fetched.length }, "Listings synced from store");
		return { synced: fetched.length };
	}

	static async getAll(appId: string) {
		return db.select().from(listings).where(eq(listings.appId, appId));
	}

	static async getByLanguage(appId: string, language: string) {
		const result = await db
			.select()
			.from(listings)
			.where(and(eq(listings.appId, appId), eq(listings.language, language)));

		if (result.length === 0) {
			buildError("notFound", { info: "Listing not found" });
		}

		const remote = result.find((l) => l.source === "remote");
		const draft = result.find((l) => l.source === "draft");

		return { draft: draft ?? null, remote: remote ?? null };
	}

	static async updateDraft(
		appId: string,
		language: string,
		data: Record<string, string | undefined>,
	) {
		const existing = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, appId),
					eq(listings.language, language),
					eq(listings.source, "draft"),
				),
			)
			.limit(1);

		if (existing.length > 0) {
			await db
				.update(listings)
				.set({ ...data, isDirty: true })
				.where(eq(listings.id, existing[0].id));
			return db
				.select()
				.from(listings)
				.where(eq(listings.id, existing[0].id))
				.then((r) => r[0]);
		}

		// Create draft from remote if it exists
		const remote = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, appId),
					eq(listings.language, language),
					eq(listings.source, "remote"),
				),
			)
			.limit(1);

		const baseData =
			remote.length > 0
				? {
						fullDesc: remote[0].fullDesc,
						keywords: remote[0].keywords,
						marketingUrl: remote[0].marketingUrl,
						privacyUrl: remote[0].privacyUrl,
						promoText: remote[0].promoText,
						shortDesc: remote[0].shortDesc,
						supportUrl: remote[0].supportUrl,
						title: remote[0].title,
						whatsNew: remote[0].whatsNew,
					}
				: {};

		const [draft] = await db
			.insert(listings)
			.values({
				...baseData,
				...data,
				appId,
				isDirty: true,
				language,
				source: "draft",
			})
			.returning();

		return draft;
	}

	static async publish(appId: string) {
		const app = await ListingsService.getAppWithStore(appId);
		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const provider = createProvider(app.store.type as StoreType, credentials);

		const dirtyDrafts = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, appId),
					eq(listings.isDirty, true),
					eq(listings.source, "draft"),
				),
			);

		if (dirtyDrafts.length === 0) {
			return { published: 0 };
		}

		for (const draft of dirtyDrafts) {
			// Get current remote for history tracking
			const [remote] = await db
				.select()
				.from(listings)
				.where(
					and(
						eq(listings.appId, appId),
						eq(listings.language, draft.language),
						eq(listings.source, "remote"),
					),
				)
				.limit(1);

			// Push to store
			await provider.updateListing(app.externalId, draft.language, {
				fullDesc: draft.fullDesc ?? undefined,
				keywords: draft.keywords ?? undefined,
				marketingUrl: draft.marketingUrl ?? undefined,
				privacyUrl: draft.privacyUrl ?? undefined,
				promoText: draft.promoText ?? undefined,
				shortDesc: draft.shortDesc ?? undefined,
				supportUrl: draft.supportUrl ?? undefined,
				title: draft.title ?? undefined,
				whatsNew: draft.whatsNew ?? undefined,
			});

			// Record history for changed fields
			for (const field of LISTING_FIELDS) {
				const oldVal = remote?.[field] ?? null;
				const newVal = draft[field] ?? null;
				if (oldVal !== newVal) {
					await db.insert(listingHistory).values({
						appId,
						field,
						language: draft.language,
						listingId: draft.id,
						newValue: newVal,
						oldValue: oldVal,
						publishedAt: new Date(),
					});
				}
			}

			// Update remote with draft values
			if (remote) {
				await db
					.update(listings)
					.set({
						fullDesc: draft.fullDesc,
						keywords: draft.keywords,
						marketingUrl: draft.marketingUrl,
						privacyUrl: draft.privacyUrl,
						promoText: draft.promoText,
						shortDesc: draft.shortDesc,
						supportUrl: draft.supportUrl,
						syncedAt: new Date(),
						title: draft.title,
						whatsNew: draft.whatsNew,
					})
					.where(eq(listings.id, remote.id));
			}

			// Mark draft as clean
			await db
				.update(listings)
				.set({ isDirty: false })
				.where(eq(listings.id, draft.id));
		}

		await provider.publishListings(app.externalId);

		log.info({ appId, count: dirtyDrafts.length }, "Listings published");
		return { published: dirtyDrafts.length };
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

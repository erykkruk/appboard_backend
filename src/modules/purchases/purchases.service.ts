import { and, eq } from "drizzle-orm";
import type { StoreType } from "@/config/const";
import { createProvider } from "@/providers";
import type {
	InAppPurchaseCreateData,
	InAppPurchaseUpdateData,
	StoreProvider,
	SubscriptionCreateData,
} from "@/providers/store-provider";
import { decrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import {
	apps,
	inAppPurchases,
	purchaseLocalizations,
	purchasePrices,
	stores,
	subscriptionGroups,
} from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("purchases-service");

export class PurchasesService {
	static async checkMonetizationSupport(appId: string, workspaceId: string) {
		const { provider, externalAppId } = await PurchasesService.getAppProvider(
			appId,
			workspaceId,
		);
		return provider.checkMonetizationSupport(externalAppId);
	}

	static async syncPurchases(appId: string, workspaceId: string) {
		const [app] = await db
			.select({
				app: apps,
				store: stores,
			})
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(and(eq(apps.id, appId), eq(stores.workspaceId, workspaceId)))
			.limit(1);

		if (!app) buildError("notFound", { info: "App not found" });

		if (!app.store.credentials) {
			buildError("storeConnectionFailed", {
				info: "Store has no credentials",
			});
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		const provider = createProvider(app.store.type as StoreType, credentials);

		// Sync subscription groups
		const groups = await provider.fetchSubscriptionGroups(app.app.externalId);
		let syncedGroups = 0;
		let syncedSubscriptions = 0;

		for (const group of groups) {
			const [dbGroup] = await db
				.insert(subscriptionGroups)
				.values({
					appId,
					externalId: group.externalId,
					name: group.name,
					syncedAt: new Date(),
				})
				.onConflictDoUpdate({
					set: {
						name: group.name,
						syncedAt: new Date(),
					},
					target: [subscriptionGroups.appId, subscriptionGroups.externalId],
				})
				.returning();
			syncedGroups++;

			for (const sub of group.subscriptions) {
				const [dbPurchase] = await db
					.insert(inAppPurchases)
					.values({
						appId,
						duration: sub.duration,
						externalId: sub.externalId,
						groupId: dbGroup.id,
						name: sub.name,
						productId: sub.productId,
						productType: sub.productType,
						status: sub.status,
						syncedAt: new Date(),
					})
					.onConflictDoUpdate({
						set: {
							duration: sub.duration,
							groupId: dbGroup.id,
							name: sub.name,
							productType: sub.productType,
							status: sub.status,
							syncedAt: new Date(),
						},
						target: [inAppPurchases.appId, inAppPurchases.externalId],
					})
					.returning();
				syncedSubscriptions++;

				await PurchasesService.syncLocalizations(
					dbPurchase.id,
					sub.localizations ?? [],
				);
				await PurchasesService.syncPrices(dbPurchase.id, sub.prices ?? []);
			}
		}

		// Sync standalone in-app purchases (consumables, non-consumables)
		const iaps = await provider.fetchInAppPurchases(app.app.externalId);
		let syncedIaps = 0;

		for (const iap of iaps) {
			const [dbPurchase] = await db
				.insert(inAppPurchases)
				.values({
					appId,
					externalId: iap.externalId,
					name: iap.name,
					productId: iap.productId,
					productType: iap.productType,
					status: iap.status,
					syncedAt: new Date(),
				})
				.onConflictDoUpdate({
					set: {
						name: iap.name,
						productType: iap.productType,
						status: iap.status,
						syncedAt: new Date(),
					},
					target: [inAppPurchases.appId, inAppPurchases.externalId],
				})
				.returning();
			syncedIaps++;

			await PurchasesService.syncLocalizations(
				dbPurchase.id,
				iap.localizations ?? [],
			);
			await PurchasesService.syncPrices(dbPurchase.id, iap.prices ?? []);
		}

		log.info(
			{
				appId,
				syncedGroups,
				syncedIaps,
				syncedSubscriptions,
			},
			"Purchases synced",
		);

		return {
			syncedGroups,
			syncedIaps,
			syncedSubscriptions,
		};
	}

	static async listPurchases(appId: string) {
		const purchases = await db
			.select()
			.from(inAppPurchases)
			.where(eq(inAppPurchases.appId, appId));

		// Enrich with localizations and prices
		const enriched = await Promise.all(
			purchases.map(async (purchase) => {
				const locs = await db
					.select()
					.from(purchaseLocalizations)
					.where(eq(purchaseLocalizations.purchaseId, purchase.id));

				const prices = await db
					.select()
					.from(purchasePrices)
					.where(eq(purchasePrices.purchaseId, purchase.id));

				return {
					...purchase,
					localizations: locs,
					prices,
				};
			}),
		);

		return enriched;
	}

	static async getPurchase(purchaseId: string) {
		const [purchase] = await db
			.select()
			.from(inAppPurchases)
			.where(eq(inAppPurchases.id, purchaseId))
			.limit(1);

		if (!purchase) buildError("notFound", { info: "Purchase not found" });

		const locs = await db
			.select()
			.from(purchaseLocalizations)
			.where(eq(purchaseLocalizations.purchaseId, purchaseId));

		const prices = await db
			.select()
			.from(purchasePrices)
			.where(eq(purchasePrices.purchaseId, purchaseId));

		return {
			...purchase,
			localizations: locs,
			prices,
		};
	}

	static async listSubscriptionGroups(appId: string) {
		const groups = await db
			.select()
			.from(subscriptionGroups)
			.where(eq(subscriptionGroups.appId, appId));

		const enriched = await Promise.all(
			groups.map(async (group) => {
				const subs = await db
					.select()
					.from(inAppPurchases)
					.where(
						and(
							eq(inAppPurchases.groupId, group.id),
							eq(inAppPurchases.productType, "auto_renewable"),
						),
					);

				const enrichedSubs = await Promise.all(
					subs.map(async (sub) => {
						const locs = await db
							.select()
							.from(purchaseLocalizations)
							.where(eq(purchaseLocalizations.purchaseId, sub.id));
						const prices = await db
							.select()
							.from(purchasePrices)
							.where(eq(purchasePrices.purchaseId, sub.id));
						return { ...sub, localizations: locs, prices };
					}),
				);

				return { ...group, subscriptions: enrichedSubs };
			}),
		);

		return enriched;
	}

	static async getSubscriptionGroup(groupId: string) {
		const [group] = await db
			.select()
			.from(subscriptionGroups)
			.where(eq(subscriptionGroups.id, groupId))
			.limit(1);

		if (!group)
			buildError("notFound", { info: "Subscription group not found" });

		const subs = await db
			.select()
			.from(inAppPurchases)
			.where(eq(inAppPurchases.groupId, groupId));

		const enrichedSubs = await Promise.all(
			subs.map(async (sub) => {
				const locs = await db
					.select()
					.from(purchaseLocalizations)
					.where(eq(purchaseLocalizations.purchaseId, sub.id));
				const prices = await db
					.select()
					.from(purchasePrices)
					.where(eq(purchasePrices.purchaseId, sub.id));
				return { ...sub, localizations: locs, prices };
			}),
		);

		return { ...group, subscriptions: enrichedSubs };
	}

	static async createPurchase(
		appId: string,
		workspaceId: string,
		data: InAppPurchaseCreateData,
	) {
		const { provider, externalAppId } = await PurchasesService.getAppProvider(
			appId,
			workspaceId,
		);

		const result = await provider.createInAppPurchase(externalAppId, data);

		const [dbPurchase] = await db
			.insert(inAppPurchases)
			.values({
				appId,
				externalId: result.externalId,
				name: result.name,
				productId: result.productId,
				productType: result.productType,
				status: result.status,
				syncedAt: new Date(),
			})
			.onConflictDoUpdate({
				set: {
					name: result.name,
					productType: result.productType,
					status: result.status,
					syncedAt: new Date(),
				},
				target: [inAppPurchases.appId, inAppPurchases.externalId],
			})
			.returning();

		await PurchasesService.syncLocalizations(
			dbPurchase.id,
			result.localizations ?? [],
		);
		await PurchasesService.syncPrices(dbPurchase.id, result.prices ?? []);

		log.info({ appId, purchaseId: dbPurchase.id }, "Purchase created");
		return PurchasesService.getPurchase(dbPurchase.id);
	}

	static async updatePurchase(
		purchaseId: string,
		workspaceId: string,
		data: InAppPurchaseUpdateData,
	) {
		const purchase = await PurchasesService.getPurchaseWithApp(
			purchaseId,
			workspaceId,
		);

		const { provider, externalAppId } = await PurchasesService.getAppProvider(
			purchase.appId,
			workspaceId,
		);

		if (purchase.groupId) {
			await provider.updateSubscription(
				externalAppId,
				purchase.externalId,
				data,
			);
		} else {
			await provider.updateInAppPurchase(
				externalAppId,
				purchase.externalId,
				data,
			);
		}

		if (data.name) {
			await db
				.update(inAppPurchases)
				.set({ name: data.name, syncedAt: new Date() })
				.where(eq(inAppPurchases.id, purchaseId));
		}

		if (data.localizations?.length) {
			await PurchasesService.syncLocalizations(purchaseId, data.localizations);
		}

		if (data.prices?.length) {
			await PurchasesService.syncPrices(purchaseId, data.prices);
		}

		log.info({ purchaseId }, "Purchase updated");
		return PurchasesService.getPurchase(purchaseId);
	}

	static async deletePurchase(purchaseId: string, workspaceId: string) {
		const purchase = await PurchasesService.getPurchaseWithApp(
			purchaseId,
			workspaceId,
		);

		const { provider, externalAppId } = await PurchasesService.getAppProvider(
			purchase.appId,
			workspaceId,
		);

		if (purchase.groupId) {
			await provider.deleteSubscription(externalAppId, purchase.externalId);
		} else {
			await provider.deleteInAppPurchase(externalAppId, purchase.externalId);
		}

		await db.delete(inAppPurchases).where(eq(inAppPurchases.id, purchaseId));

		log.info({ purchaseId }, "Purchase deleted");
	}

	static async createGroup(appId: string, workspaceId: string, name: string) {
		const { provider, externalAppId } = await PurchasesService.getAppProvider(
			appId,
			workspaceId,
		);

		const result = await provider.createSubscriptionGroup(externalAppId, name);

		const [dbGroup] = await db
			.insert(subscriptionGroups)
			.values({
				appId,
				externalId: result.externalId,
				name: result.name,
				syncedAt: new Date(),
			})
			.onConflictDoUpdate({
				set: {
					name: result.name,
					syncedAt: new Date(),
				},
				target: [subscriptionGroups.appId, subscriptionGroups.externalId],
			})
			.returning();

		log.info({ appId, groupId: dbGroup.id }, "Subscription group created");
		return { ...dbGroup, subscriptions: [] };
	}

	static async updateGroup(
		groupId: string,
		appId: string,
		workspaceId: string,
		data: { name?: string },
	) {
		const [group] = await db
			.select()
			.from(subscriptionGroups)
			.where(
				and(
					eq(subscriptionGroups.id, groupId),
					eq(subscriptionGroups.appId, appId),
				),
			)
			.limit(1);

		if (!group)
			buildError("notFound", { info: "Subscription group not found" });

		if (data.name) {
			const { provider, externalAppId } = await PurchasesService.getAppProvider(
				appId,
				workspaceId,
			);

			await provider.updateSubscriptionGroup(
				externalAppId,
				group.externalId,
				data.name,
			);

			await db
				.update(subscriptionGroups)
				.set({ name: data.name, syncedAt: new Date() })
				.where(eq(subscriptionGroups.id, groupId));
		}

		log.info({ groupId }, "Subscription group updated");
		return PurchasesService.getSubscriptionGroup(groupId);
	}

	static async createSubscription(
		appId: string,
		workspaceId: string,
		groupId: string,
		data: SubscriptionCreateData,
	) {
		// Verify group exists and belongs to this app
		const [group] = await db
			.select()
			.from(subscriptionGroups)
			.where(
				and(
					eq(subscriptionGroups.id, groupId),
					eq(subscriptionGroups.appId, appId),
				),
			)
			.limit(1);

		if (!group)
			buildError("notFound", { info: "Subscription group not found" });

		const { provider, externalAppId } = await PurchasesService.getAppProvider(
			appId,
			workspaceId,
		);

		const result = await provider.createSubscription(
			externalAppId,
			group.externalId,
			data,
		);

		const [dbPurchase] = await db
			.insert(inAppPurchases)
			.values({
				appId,
				duration: result.duration,
				externalId: result.externalId,
				groupId: group.id,
				name: result.name,
				productId: result.productId,
				productType: "auto_renewable",
				status: result.status,
				syncedAt: new Date(),
			})
			.onConflictDoUpdate({
				set: {
					duration: result.duration,
					groupId: group.id,
					name: result.name,
					status: result.status,
					syncedAt: new Date(),
				},
				target: [inAppPurchases.appId, inAppPurchases.externalId],
			})
			.returning();

		await PurchasesService.syncLocalizations(
			dbPurchase.id,
			result.localizations ?? [],
		);
		await PurchasesService.syncPrices(dbPurchase.id, result.prices ?? []);

		log.info(
			{ appId, groupId, purchaseId: dbPurchase.id },
			"Subscription created",
		);
		return PurchasesService.getPurchase(dbPurchase.id);
	}

	private static async getAppProvider(
		appId: string,
		workspaceId: string,
	): Promise<{ externalAppId: string; provider: StoreProvider }> {
		const [app] = await db
			.select({
				app: apps,
				store: stores,
			})
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(and(eq(apps.id, appId), eq(stores.workspaceId, workspaceId)))
			.limit(1);

		if (!app) buildError("notFound", { info: "App not found" });

		if (!app.store.credentials) {
			buildError("storeConnectionFailed", {
				info: "Store has no credentials",
			});
		}

		const credentials = JSON.parse(decrypt(app.store.credentials));
		const provider = createProvider(app.store.type as StoreType, credentials);

		return { externalAppId: app.app.externalId, provider };
	}

	private static async getPurchaseWithApp(
		purchaseId: string,
		workspaceId: string,
	) {
		const [result] = await db
			.select({
				appId: inAppPurchases.appId,
				externalId: inAppPurchases.externalId,
				groupId: inAppPurchases.groupId,
				id: inAppPurchases.id,
			})
			.from(inAppPurchases)
			.innerJoin(apps, eq(inAppPurchases.appId, apps.id))
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(
				and(
					eq(inAppPurchases.id, purchaseId),
					eq(stores.workspaceId, workspaceId),
				),
			)
			.limit(1);

		if (!result) buildError("notFound", { info: "Purchase not found" });

		return result;
	}

	private static async syncLocalizations(
		purchaseId: string,
		localizations: Array<{
			description?: string;
			externalId?: string;
			language: string;
			name?: string;
		}>,
	) {
		for (const loc of localizations) {
			await db
				.insert(purchaseLocalizations)
				.values({
					description: loc.description,
					externalId: loc.externalId,
					language: loc.language,
					name: loc.name,
					purchaseId,
					syncedAt: new Date(),
				})
				.onConflictDoUpdate({
					set: {
						description: loc.description,
						externalId: loc.externalId,
						name: loc.name,
						syncedAt: new Date(),
					},
					target: [
						purchaseLocalizations.purchaseId,
						purchaseLocalizations.language,
					],
				});
		}
	}

	private static async syncPrices(
		purchaseId: string,
		prices: Array<{
			currency: string;
			externalId?: string;
			price: string;
			territory: string;
		}>,
	) {
		for (const price of prices) {
			await db
				.insert(purchasePrices)
				.values({
					currency: price.currency,
					externalId: price.externalId,
					price: price.price,
					purchaseId,
					syncedAt: new Date(),
					territory: price.territory,
				})
				.onConflictDoUpdate({
					set: {
						currency: price.currency,
						externalId: price.externalId,
						price: price.price,
						syncedAt: new Date(),
					},
					target: [purchasePrices.purchaseId, purchasePrices.territory],
				});
		}
	}
}

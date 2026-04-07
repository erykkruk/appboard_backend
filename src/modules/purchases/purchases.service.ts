import { and, eq, inArray } from "drizzle-orm";
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
	purchaseReviewInfo,
	stores,
	subscriptionGroupLocalizations,
	subscriptionGroupReviewInfo,
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

			// Sync group localizations from Apple
			if (provider.fetchGroupLocalizations) {
				try {
					const groupLocs = await provider.fetchGroupLocalizations(
						group.externalId,
					);
					for (const loc of groupLocs) {
						await db
							.insert(subscriptionGroupLocalizations)
							.values({
								externalId: loc.externalId,
								groupId: dbGroup.id,
								language: loc.language,
								name: loc.name,
							})
							.onConflictDoUpdate({
								set: {
									externalId: loc.externalId,
									name: loc.name,
								},
								target: [
									subscriptionGroupLocalizations.groupId,
									subscriptionGroupLocalizations.language,
								],
							});
					}
				} catch (err) {
					log.warn(
						{ err, groupId: dbGroup.id },
						"Failed to sync group localizations — continuing",
					);
				}
			}

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

			// Sync group availability from first subscription
			if (
				provider.fetchSubscriptionAvailability &&
				group.subscriptions.length > 0
			) {
				try {
					const territories = await provider.fetchSubscriptionAvailability(
						group.subscriptions[0].externalId,
					);
					if (territories.length > 0) {
						await db
							.update(subscriptionGroups)
							.set({ availableTerritories: territories })
							.where(eq(subscriptionGroups.id, dbGroup.id));
					}
				} catch (err) {
					log.debug(
						{ err, groupId: dbGroup.id },
						"Could not sync subscription availability",
					);
				}
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

	static async listPurchases(appId: string, workspaceId: string) {
		const purchases = await db
			.select({ purchase: inAppPurchases })
			.from(inAppPurchases)
			.innerJoin(apps, eq(inAppPurchases.appId, apps.id))
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(
				and(
					eq(inAppPurchases.appId, appId),
					eq(stores.workspaceId, workspaceId),
				),
			)
			.then((rows) => rows.map((r) => r.purchase));

		if (purchases.length === 0) return [];

		const purchaseIds = purchases.map((p) => p.id);

		const [allLocs, allPrices] = await Promise.all([
			db
				.select()
				.from(purchaseLocalizations)
				.where(inArray(purchaseLocalizations.purchaseId, purchaseIds)),
			db
				.select()
				.from(purchasePrices)
				.where(inArray(purchasePrices.purchaseId, purchaseIds)),
		]);

		return purchases.map((purchase) => ({
			...purchase,
			localizations: allLocs.filter((l) => l.purchaseId === purchase.id),
			prices: allPrices.filter((p) => p.purchaseId === purchase.id),
		}));
	}

	static async getPurchase(purchaseId: string, workspaceId: string) {
		const [result] = await db
			.select({ purchase: inAppPurchases })
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

		const purchase = result.purchase;

		const [locs, prices, [revInfo]] = await Promise.all([
			db
				.select()
				.from(purchaseLocalizations)
				.where(eq(purchaseLocalizations.purchaseId, purchaseId)),
			db
				.select()
				.from(purchasePrices)
				.where(eq(purchasePrices.purchaseId, purchaseId)),
			db
				.select()
				.from(purchaseReviewInfo)
				.where(eq(purchaseReviewInfo.purchaseId, purchaseId))
				.limit(1),
		]);

		return {
			...purchase,
			localizations: locs,
			prices,
			reviewInfo: revInfo ?? null,
		};
	}

	static async listSubscriptionGroups(appId: string, workspaceId: string) {
		const groups = await db
			.select({ group: subscriptionGroups })
			.from(subscriptionGroups)
			.innerJoin(apps, eq(subscriptionGroups.appId, apps.id))
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(
				and(
					eq(subscriptionGroups.appId, appId),
					eq(stores.workspaceId, workspaceId),
				),
			)
			.then((rows) => rows.map((r) => r.group));

		if (groups.length === 0) return [];

		const groupIds = groups.map((g) => g.id);

		const allSubs = await db
			.select()
			.from(inAppPurchases)
			.where(
				and(
					inArray(inAppPurchases.groupId, groupIds),
					eq(inAppPurchases.productType, "auto_renewable"),
				),
			);

		if (allSubs.length === 0) {
			return groups.map((group) => ({ ...group, subscriptions: [] }));
		}

		const subIds = allSubs.map((s) => s.id);

		const [allLocs, allPrices] = await Promise.all([
			db
				.select()
				.from(purchaseLocalizations)
				.where(inArray(purchaseLocalizations.purchaseId, subIds)),
			db
				.select()
				.from(purchasePrices)
				.where(inArray(purchasePrices.purchaseId, subIds)),
		]);

		return groups.map((group) => ({
			...group,
			subscriptions: allSubs
				.filter((s) => s.groupId === group.id)
				.map((sub) => ({
					...sub,
					localizations: allLocs.filter((l) => l.purchaseId === sub.id),
					prices: allPrices.filter((p) => p.purchaseId === sub.id),
				})),
		}));
	}

	static async getSubscriptionGroup(groupId: string, workspaceId: string) {
		const [result] = await db
			.select({ group: subscriptionGroups })
			.from(subscriptionGroups)
			.innerJoin(apps, eq(subscriptionGroups.appId, apps.id))
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(
				and(
					eq(subscriptionGroups.id, groupId),
					eq(stores.workspaceId, workspaceId),
				),
			)
			.limit(1);

		if (!result)
			buildError("notFound", { info: "Subscription group not found" });

		const group = result.group;

		const [subs, groupLocs, [groupRevInfo]] = await Promise.all([
			db
				.select()
				.from(inAppPurchases)
				.where(eq(inAppPurchases.groupId, groupId)),
			db
				.select()
				.from(subscriptionGroupLocalizations)
				.where(eq(subscriptionGroupLocalizations.groupId, groupId)),
			db
				.select()
				.from(subscriptionGroupReviewInfo)
				.where(eq(subscriptionGroupReviewInfo.groupId, groupId))
				.limit(1),
		]);

		if (subs.length === 0) {
			return {
				...group,
				localizations: groupLocs,
				reviewInfo: groupRevInfo ?? null,
				subscriptions: [],
			};
		}

		const subIds = subs.map((s) => s.id);

		const [allLocs, allPrices] = await Promise.all([
			db
				.select()
				.from(purchaseLocalizations)
				.where(inArray(purchaseLocalizations.purchaseId, subIds)),
			db
				.select()
				.from(purchasePrices)
				.where(inArray(purchasePrices.purchaseId, subIds)),
		]);

		return {
			...group,
			localizations: groupLocs,
			reviewInfo: groupRevInfo ?? null,
			subscriptions: subs.map((sub) => ({
				...sub,
				localizations: allLocs.filter((l) => l.purchaseId === sub.id),
				prices: allPrices.filter((p) => p.purchaseId === sub.id),
			})),
		};
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
		return PurchasesService.getPurchase(dbPurchase.id, workspaceId);
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
		return PurchasesService.getPurchase(purchaseId, workspaceId);
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

	static async deleteGroup(
		groupId: string,
		appId: string,
		workspaceId: string,
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

		const { provider, externalAppId } = await PurchasesService.getAppProvider(
			appId,
			workspaceId,
		);

		// Delete all subscriptions from store API first
		const subs = await db
			.select({ externalId: inAppPurchases.externalId, id: inAppPurchases.id })
			.from(inAppPurchases)
			.where(eq(inAppPurchases.groupId, groupId));

		for (const sub of subs) {
			try {
				await provider.deleteSubscription(externalAppId, sub.externalId);
			} catch (err) {
				log.warn(
					{ err, subId: sub.id },
					"Failed to delete subscription from store — continuing",
				);
			}
		}

		// Delete group from store API
		try {
			await provider.deleteSubscriptionGroup(externalAppId, group.externalId);
		} catch (err) {
			log.warn(
				{ err, groupId },
				"Failed to delete subscription group from store — removing locally",
			);
		}

		// Clean up local DB
		await db.delete(inAppPurchases).where(eq(inAppPurchases.groupId, groupId));

		await db
			.delete(subscriptionGroups)
			.where(eq(subscriptionGroups.id, groupId));

		log.info({ appId, groupId }, "Subscription group deleted");
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
		return PurchasesService.getSubscriptionGroup(groupId, workspaceId);
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
		return PurchasesService.getPurchase(dbPurchase.id, workspaceId);
	}

	// ── Group Localizations ─────────────────────────────────────────

	static async listGroupLocalizations(groupId: string) {
		return db
			.select()
			.from(subscriptionGroupLocalizations)
			.where(eq(subscriptionGroupLocalizations.groupId, groupId));
	}

	static async upsertGroupLocalizations(
		groupId: string,
		appId: string,
		workspaceId: string,
		localizations: Array<{
			description?: string | null;
			language: string;
			name?: string | null;
		}>,
	) {
		// Get group's externalId and provider for pushing to store
		const [group] = await db
			.select({
				externalId: subscriptionGroups.externalId,
			})
			.from(subscriptionGroups)
			.where(eq(subscriptionGroups.id, groupId))
			.limit(1);

		if (!group)
			buildError("notFound", { info: "Subscription group not found" });

		const { provider } = await PurchasesService.getAppProvider(
			appId,
			workspaceId,
		);

		for (const loc of localizations) {
			// Check if localization already exists in DB (to get externalId)
			const [existing] = await db
				.select({
					externalId: subscriptionGroupLocalizations.externalId,
				})
				.from(subscriptionGroupLocalizations)
				.where(
					and(
						eq(subscriptionGroupLocalizations.groupId, groupId),
						eq(subscriptionGroupLocalizations.language, loc.language),
					),
				)
				.limit(1);

			let externalId = existing?.externalId ?? null;

			// Push to Apple
			if (
				loc.name &&
				provider.createGroupLocalization &&
				provider.updateGroupLocalization
			) {
				try {
					if (externalId) {
						await provider.updateGroupLocalization(externalId, {
							name: loc.name,
						});
					} else {
						const result = await provider.createGroupLocalization(
							group.externalId,
							loc.language,
							{ name: loc.name },
						);
						externalId = result.externalId;
					}
				} catch (err) {
					log.warn(
						{ err, groupId, language: loc.language },
						"Failed to push group localization to store — saving locally",
					);
				}
			}

			await db
				.insert(subscriptionGroupLocalizations)
				.values({
					description: loc.description,
					externalId,
					groupId,
					language: loc.language,
					name: loc.name,
				})
				.onConflictDoUpdate({
					set: {
						description: loc.description,
						externalId,
						name: loc.name,
					},
					target: [
						subscriptionGroupLocalizations.groupId,
						subscriptionGroupLocalizations.language,
					],
				});
		}
		log.info(
			{ count: localizations.length, groupId },
			"Group localizations upserted",
		);

		// Propagate to subscriptions that inherit group localizations
		await PurchasesService.propagateGroupLocalizationsToSubscriptions(
			groupId,
			appId,
			workspaceId,
		);

		return PurchasesService.listGroupLocalizations(groupId);
	}

	static async deleteGroupLocalization(
		groupId: string,
		appId: string,
		workspaceId: string,
		language: string,
	) {
		// Get the localization to check for externalId
		const [existing] = await db
			.select()
			.from(subscriptionGroupLocalizations)
			.where(
				and(
					eq(subscriptionGroupLocalizations.groupId, groupId),
					eq(subscriptionGroupLocalizations.language, language),
				),
			)
			.limit(1);

		if (!existing)
			buildError("notFound", { info: "Group localization not found" });

		// Delete from Apple if it has an externalId
		if (existing.externalId) {
			const { provider } = await PurchasesService.getAppProvider(
				appId,
				workspaceId,
			);
			if (provider.deleteGroupLocalization) {
				try {
					await provider.deleteGroupLocalization(existing.externalId);
				} catch (err) {
					log.warn(
						{ err, externalId: existing.externalId, groupId, language },
						"Failed to delete group localization from store — removing locally",
					);
				}
			}
		}

		await db
			.delete(subscriptionGroupLocalizations)
			.where(
				and(
					eq(subscriptionGroupLocalizations.groupId, groupId),
					eq(subscriptionGroupLocalizations.language, language),
				),
			);

		log.info({ groupId, language }, "Group localization deleted");

		// Propagate updated localizations to subscriptions that inherit
		await PurchasesService.propagateGroupLocalizationsToSubscriptions(
			groupId,
			appId,
			workspaceId,
		);
	}

	// ── Group Availability ──────────────────────────────────────────

	static async getGroupAvailability(groupId: string) {
		const [group] = await db
			.select({ availableTerritories: subscriptionGroups.availableTerritories })
			.from(subscriptionGroups)
			.where(eq(subscriptionGroups.id, groupId))
			.limit(1);

		if (!group)
			buildError("notFound", { info: "Subscription group not found" });

		return { territories: group.availableTerritories ?? [] };
	}

	static async updateGroupAvailability(
		groupId: string,
		appId: string,
		workspaceId: string,
		territories: string[],
	) {
		const result = await db
			.update(subscriptionGroups)
			.set({ availableTerritories: territories })
			.where(eq(subscriptionGroups.id, groupId))
			.returning();

		if (result.length === 0)
			buildError("notFound", { info: "Subscription group not found" });

		// Push availability to each subscription in the group that uses group default
		const { provider } = await PurchasesService.getAppProvider(
			appId,
			workspaceId,
		);
		if (provider.updateSubscriptionAvailability) {
			const subs = await db
				.select({
					availableTerritories: inAppPurchases.availableTerritories,
					externalId: inAppPurchases.externalId,
					id: inAppPurchases.id,
				})
				.from(inAppPurchases)
				.where(eq(inAppPurchases.groupId, groupId));

			for (const sub of subs) {
				// Only push to subs using group default (null territories)
				if (sub.availableTerritories === null) {
					try {
						await provider.updateSubscriptionAvailability(
							sub.externalId,
							territories,
						);
					} catch (err) {
						log.warn(
							{ err, subId: sub.id },
							"Failed to push group availability to subscription — continuing",
						);
					}
				}
			}
		}

		log.info(
			{ count: territories.length, groupId },
			"Group availability updated",
		);
		return { territories };
	}

	// ── Group Review Info ───────────────────────────────────────────

	static async getGroupReviewInfo(groupId: string) {
		const [info] = await db
			.select()
			.from(subscriptionGroupReviewInfo)
			.where(eq(subscriptionGroupReviewInfo.groupId, groupId))
			.limit(1);

		return info ?? null;
	}

	static async upsertGroupReviewInfo(
		groupId: string,
		data: { reviewNotes?: string | null; screenshotUrl?: string | null },
	) {
		const [result] = await db
			.insert(subscriptionGroupReviewInfo)
			.values({
				groupId,
				reviewNotes: data.reviewNotes,
				screenshotUrl: data.screenshotUrl,
			})
			.onConflictDoUpdate({
				set: {
					reviewNotes: data.reviewNotes,
					screenshotUrl: data.screenshotUrl,
				},
				target: subscriptionGroupReviewInfo.groupId,
			})
			.returning();

		log.info({ groupId }, "Group review info upserted");
		return result;
	}

	// ── Subscription Availability Override ───────────────────────────

	static async getSubscriptionAvailability(purchaseId: string) {
		const [purchase] = await db
			.select({ availableTerritories: inAppPurchases.availableTerritories })
			.from(inAppPurchases)
			.where(eq(inAppPurchases.id, purchaseId))
			.limit(1);

		if (!purchase) buildError("notFound", { info: "Purchase not found" });

		return { territories: purchase.availableTerritories };
	}

	static async updateSubscriptionAvailability(
		purchaseId: string,
		appId: string,
		workspaceId: string,
		territories: string[] | null,
	) {
		const result = await db
			.update(inAppPurchases)
			.set({ availableTerritories: territories })
			.where(eq(inAppPurchases.id, purchaseId))
			.returning();

		if (result.length === 0)
			buildError("notFound", { info: "Purchase not found" });

		// Push to store if territories are set (not null/group default)
		const purchase = result[0];
		if (territories && purchase.externalId) {
			const { provider } = await PurchasesService.getAppProvider(
				appId,
				workspaceId,
			);
			if (provider.updateSubscriptionAvailability) {
				try {
					await provider.updateSubscriptionAvailability(
						purchase.externalId,
						territories,
					);
				} catch (err) {
					log.warn(
						{ err, purchaseId },
						"Failed to push subscription availability to store — saved locally",
					);
				}
			}
		}

		log.info(
			{ purchaseId, territories: territories?.length ?? "group_default" },
			"Subscription availability updated",
		);
		return { territories };
	}

	// ── Subscription Review Info Override ────────────────────────────

	static async getSubscriptionReviewInfo(purchaseId: string) {
		const [info] = await db
			.select()
			.from(purchaseReviewInfo)
			.where(eq(purchaseReviewInfo.purchaseId, purchaseId))
			.limit(1);

		return info ?? null;
	}

	static async upsertSubscriptionReviewInfo(
		purchaseId: string,
		data: {
			reviewNotes?: string | null;
			screenshotUrl?: string | null;
			useGroupDefault?: boolean;
		},
	) {
		const [result] = await db
			.insert(purchaseReviewInfo)
			.values({
				purchaseId,
				reviewNotes: data.reviewNotes,
				screenshotUrl: data.screenshotUrl,
				useGroupDefault: data.useGroupDefault ?? true,
			})
			.onConflictDoUpdate({
				set: {
					reviewNotes: data.reviewNotes,
					screenshotUrl: data.screenshotUrl,
					useGroupDefault: data.useGroupDefault ?? true,
				},
				target: purchaseReviewInfo.purchaseId,
			})
			.returning();

		log.info({ purchaseId }, "Purchase review info upserted");
		return result;
	}

	// ── Family Sharing ──────────────────────────────────────────────

	static async updateFamilySharing(
		purchaseId: string,
		appId: string,
		workspaceId: string,
		familySharable: boolean,
	) {
		const result = await db
			.update(inAppPurchases)
			.set({ familySharable })
			.where(eq(inAppPurchases.id, purchaseId))
			.returning();

		if (result.length === 0)
			buildError("notFound", { info: "Purchase not found" });

		// Push to store
		const purchase = result[0];
		if (purchase.externalId) {
			const { provider } = await PurchasesService.getAppProvider(
				appId,
				workspaceId,
			);
			if (provider.updateFamilySharing) {
				try {
					await provider.updateFamilySharing(
						purchase.externalId,
						familySharable,
					);
				} catch (err) {
					log.warn(
						{ err, purchaseId },
						"Failed to push family sharing to store — saved locally",
					);
				}
			}
		}

		log.info({ familySharable, purchaseId }, "Family sharing updated");
		return result[0];
	}

	// ── Effective Values (Merge Logic) ──────────────────────────────

	static async getEffectiveAvailability(purchaseId: string) {
		const [purchase] = await db
			.select({
				availableTerritories: inAppPurchases.availableTerritories,
				groupId: inAppPurchases.groupId,
			})
			.from(inAppPurchases)
			.where(eq(inAppPurchases.id, purchaseId))
			.limit(1);

		if (!purchase) buildError("notFound", { info: "Purchase not found" });

		if (purchase.availableTerritories !== null) {
			return {
				source: "subscription" as const,
				territories: purchase.availableTerritories,
			};
		}

		if (purchase.groupId) {
			const [group] = await db
				.select({
					availableTerritories: subscriptionGroups.availableTerritories,
				})
				.from(subscriptionGroups)
				.where(eq(subscriptionGroups.id, purchase.groupId))
				.limit(1);
			return {
				source: "group" as const,
				territories: group?.availableTerritories ?? [],
			};
		}

		return { source: "none" as const, territories: [] };
	}

	static async getEffectiveReviewInfo(purchaseId: string) {
		const [purchase] = await db
			.select({ groupId: inAppPurchases.groupId })
			.from(inAppPurchases)
			.where(eq(inAppPurchases.id, purchaseId))
			.limit(1);

		if (!purchase) buildError("notFound", { info: "Purchase not found" });

		const [subReview] = await db
			.select()
			.from(purchaseReviewInfo)
			.where(eq(purchaseReviewInfo.purchaseId, purchaseId))
			.limit(1);

		if (subReview && !subReview.useGroupDefault) {
			return { source: "subscription" as const, ...subReview };
		}

		if (purchase.groupId) {
			const [groupReview] = await db
				.select()
				.from(subscriptionGroupReviewInfo)
				.where(eq(subscriptionGroupReviewInfo.groupId, purchase.groupId))
				.limit(1);

			if (groupReview) {
				return { source: "group" as const, ...groupReview };
			}
		}

		return null;
	}

	// ── Effective Localizations (Merge Logic) ────────────────────────

	static async getEffectiveLocalizations(purchaseId: string) {
		const [purchase] = await db
			.select({
				groupId: inAppPurchases.groupId,
				useGroupLocalizations: inAppPurchases.useGroupLocalizations,
			})
			.from(inAppPurchases)
			.where(eq(inAppPurchases.id, purchaseId))
			.limit(1);

		if (!purchase) buildError("notFound", { info: "Purchase not found" });

		// If not using group localizations or no group, return purchase's own
		if (!purchase.useGroupLocalizations || !purchase.groupId) {
			const locs = await db
				.select()
				.from(purchaseLocalizations)
				.where(eq(purchaseLocalizations.purchaseId, purchaseId));
			return {
				localizations: locs,
				source: "subscription" as const,
				useGroupLocalizations: purchase.useGroupLocalizations,
			};
		}

		// Using group localizations
		const groupLocs = await db
			.select()
			.from(subscriptionGroupLocalizations)
			.where(eq(subscriptionGroupLocalizations.groupId, purchase.groupId));

		return {
			localizations: groupLocs,
			source: "group" as const,
			useGroupLocalizations: true,
		};
	}

	static async updateUseGroupLocalizations(
		purchaseId: string,
		useGroupLocalizations: boolean,
	) {
		const [purchase] = await db
			.select({
				groupId: inAppPurchases.groupId,
				id: inAppPurchases.id,
			})
			.from(inAppPurchases)
			.where(eq(inAppPurchases.id, purchaseId))
			.limit(1);

		if (!purchase) buildError("notFound", { info: "Purchase not found" });

		await db
			.update(inAppPurchases)
			.set({ useGroupLocalizations })
			.where(eq(inAppPurchases.id, purchaseId));

		// If switching to own localizations and none exist, copy from group
		if (!useGroupLocalizations && purchase.groupId) {
			const ownLocs = await db
				.select()
				.from(purchaseLocalizations)
				.where(eq(purchaseLocalizations.purchaseId, purchaseId));

			if (ownLocs.length === 0) {
				const groupLocs = await db
					.select()
					.from(subscriptionGroupLocalizations)
					.where(eq(subscriptionGroupLocalizations.groupId, purchase.groupId));

				for (const loc of groupLocs) {
					await db
						.insert(purchaseLocalizations)
						.values({
							description: loc.description,
							language: loc.language,
							name: loc.name,
							purchaseId,
						})
						.onConflictDoUpdate({
							set: {
								description: loc.description,
								name: loc.name,
							},
							target: [
								purchaseLocalizations.purchaseId,
								purchaseLocalizations.language,
							],
						});
				}

				log.info(
					{ count: groupLocs.length, purchaseId },
					"Copied group localizations to subscription as starting point",
				);
			}
		}

		log.info(
			{ purchaseId, useGroupLocalizations },
			"Updated useGroupLocalizations",
		);
		return PurchasesService.getEffectiveLocalizations(purchaseId);
	}

	// ── Propagate Group Localizations to Subscriptions ──────────────

	private static async propagateGroupLocalizationsToSubscriptions(
		groupId: string,
		appId: string,
		workspaceId: string,
	) {
		// Find subscriptions that inherit group localizations
		const subs = await db
			.select({
				externalId: inAppPurchases.externalId,
				id: inAppPurchases.id,
			})
			.from(inAppPurchases)
			.where(
				and(
					eq(inAppPurchases.groupId, groupId),
					eq(inAppPurchases.useGroupLocalizations, true),
				),
			);

		if (subs.length === 0) return;

		// Get group localizations from DB
		const groupLocs = await db
			.select()
			.from(subscriptionGroupLocalizations)
			.where(eq(subscriptionGroupLocalizations.groupId, groupId));

		if (groupLocs.length === 0) return;

		const locData = groupLocs
			.filter((l) => l.name)
			.map((l) => ({
				description: l.description ?? undefined,
				language: l.language,
				name: l.name ?? undefined,
			}));

		if (locData.length === 0) return;

		const { provider, externalAppId } = await PurchasesService.getAppProvider(
			appId,
			workspaceId,
		);

		const results = await Promise.allSettled(
			subs.map((sub) =>
				provider.updateSubscription(externalAppId, sub.externalId, {
					localizations: locData,
				}),
			),
		);

		let propagated = 0;
		for (let i = 0; i < results.length; i++) {
			if (results[i].status === "fulfilled") {
				propagated++;
			} else {
				log.warn(
					{
						err: (results[i] as PromiseRejectedResult).reason,
						subId: subs[i].id,
					},
					"Failed to propagate group localizations to subscription",
				);
			}
		}

		log.info(
			{ groupId, propagated, total: subs.length },
			"Propagated group localizations to subscriptions",
		);
	}

	// ── Verify Group Ownership ──────────────────────────────────────

	static async verifyGroupOwnership(groupId: string, appId: string) {
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

		return group;
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
			pricePointId?: string;
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
					pricePointId: price.pricePointId,
					purchaseId,
					syncedAt: new Date(),
					territory: price.territory,
				})
				.onConflictDoUpdate({
					set: {
						currency: price.currency,
						externalId: price.externalId,
						price: price.price,
						pricePointId: price.pricePointId,
						syncedAt: new Date(),
					},
					target: [purchasePrices.purchaseId, purchasePrices.territory],
				});
		}
	}
}

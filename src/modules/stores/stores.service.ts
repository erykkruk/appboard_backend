import { and, count, eq, sql } from "drizzle-orm";
import config from "@/config";
import {
	isAlternativeStoreType,
	type Platform,
	STORE_TYPE_LABELS,
	type StoreType,
} from "@/config/const";
import {
	PUBLIC_CONNECTION_CAPABILITIES,
	resolveDefaultCapabilities,
	validateCapabilitySelection,
} from "@/config/store-capabilities";
import { AssetsService } from "@/modules/assets/assets.service";
import { FeaturesService } from "@/modules/features/features.service";
import { ListingsService } from "@/modules/listings/listings.service";
import { appstoreMeta } from "@/modules/research/appstore.client";
import { playstoreMeta } from "@/modules/research/playstore.client";
import { ResearchRunsService } from "@/modules/research/research.runs.service";
import type { ResearchAppMeta } from "@/modules/research/research.types";
import {
	decryptCredentials,
	encryptCredentials,
} from "@/modules/vault/credentials";
import { createProvider } from "@/providers";
import { validateAlternativeCredentials } from "@/providers/alternative/credentials.schema";
import { createPublicProvider } from "@/providers/public";
import { storeFactsFrom } from "@/providers/public/shared";
import type { AppData, StoreProvider } from "@/providers/store-provider";
import { db } from "@/utils/db";
import { apps, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import {
	isPublicStore,
	publicCountryFor,
	resolveProviderForStore,
} from "./provider-resolver";
import { parseStoreLink, resolveImportCountry } from "./store-url";

const log = createLogger("stores-service");

export interface ImportAppInput {
	country?: string;
	externalId?: string;
	platform?: Platform;
	url?: string;
}

export class StoresService {
	static async connect(
		workspaceId: string,
		name: string,
		type: StoreType,
		credentials: Record<string, unknown>,
		capabilities?: string[],
	) {
		// Alternative stores (Huawei AppGallery, Amazon Appstore, …) are gated
		// behind the MULTI_STORE feature flag, off by default.
		if (isAlternativeStoreType(type)) {
			const enabled = await FeaturesService.isEnabled(
				workspaceId,
				"MULTI_STORE",
			);
			if (!enabled) {
				buildError("forbidden", {
					info: "Connecting alternative app stores requires the Alternative Stores feature to be enabled.",
				});
			}
		}

		// Seeded demo connections carry canned data, not real API credentials.
		if (credentials.mock !== true) {
			validateAlternativeCredentials(type, credentials);
		}

		const provider = createProvider(type, credentials);
		const validation = await provider.validateCredentials();
		if (!validation.valid) {
			buildError("storeConnectionFailed", {
				info: validation.reason
					? `Invalid store credentials: ${validation.reason}`
					: "Invalid store credentials",
			});
		}

		// Omitted → NULL (treated as all-selectable at read time), preserving the
		// existing "connect grants everything" behaviour for callers that don't
		// send a selection. An explicit selection is validated against the catalog.
		const resolvedCapabilities = capabilities
			? validateCapabilitySelection(type, capabilities)
			: null;

		const encryptedCreds = await encryptCredentials(credentials, workspaceId);
		const [store] = await db
			.insert(stores)
			.values({
				capabilities: resolvedCapabilities,
				credentials: encryptedCreds,
				name,
				status: "connected",
				type,
				workspaceId,
			})
			.returning();

		const syncResult = await StoresService.syncApps(store.id);
		return {
			capabilities: resolvedCapabilities ?? resolveDefaultCapabilities(type),
			store,
			syncedApps: syncResult.synced,
		};
	}

	static async list(workspaceId: string) {
		return db.select().from(stores).where(eq(stores.workspaceId, workspaceId));
	}

	static async disconnect(storeId: string, workspaceId: string) {
		const [store] = await db
			.select()
			.from(stores)
			.where(and(eq(stores.id, storeId), eq(stores.workspaceId, workspaceId)))
			.limit(1);

		if (!store) buildError("notFound", { info: "Store not found" });

		await db.delete(stores).where(eq(stores.id, storeId));
		return { success: true };
	}

	static async rename(storeId: string, workspaceId: string, name: string) {
		const trimmed = name.trim();
		if (!trimmed) {
			buildError("badRequest", { info: "Store name cannot be empty" });
		}

		const [updated] = await db
			.update(stores)
			.set({ name: trimmed })
			.where(and(eq(stores.id, storeId), eq(stores.workspaceId, workspaceId)))
			.returning();

		if (!updated) buildError("notFound", { info: "Store not found" });

		log.info({ storeId }, "Store renamed");
		return updated;
	}

	/**
	 * Manually register a Google Play package on the connection and sync it.
	 * Needed for brand-new draft apps: the Reporting API (our auto-discovery)
	 * does not index apps until they have a first release, but the edits API
	 * can manage them as soon as the service account has access.
	 */
	static async addPackage(storeId: string, packageName: string) {
		const [store] = await db
			.select()
			.from(stores)
			.where(eq(stores.id, storeId))
			.limit(1);
		if (!store) buildError("notFound", { info: "Store not found" });
		if (store.type !== "google_play") {
			buildError("badRequest", {
				info: "Adding apps by package name is only supported for Google Play connections",
			});
		}
		if (!store.credentials) {
			buildError("storeConnectionFailed", { info: "Store has no credentials" });
		}

		const credentials = decryptCredentials(
			store.credentials,
			store.workspaceId,
		) as { package_names?: string[] };
		const existing = credentials.package_names ?? [];
		if (!existing.includes(packageName)) {
			credentials.package_names = [...existing, packageName];
			const encrypted = await encryptCredentials(
				credentials as Record<string, unknown>,
				store.workspaceId,
			);
			await db
				.update(stores)
				.set({ credentials: encrypted })
				.where(eq(stores.id, storeId));
			log.info({ packageName, storeId }, "Package added to connection");
		}

		// syncApps validates access: an inaccessible/unknown package surfaces
		// as a sync error the panel shows to the user.
		return StoresService.syncApps(storeId);
	}

	/**
	 * Full re-import: wipe the store's local apps (cascade removes listings,
	 * drafts, history, assets…) and fetch everything fresh from the account.
	 * Used after switching store credentials to a different account, where a
	 * plain sync would only upsert and leave stale apps behind.
	 */
	static async resyncApps(storeId: string) {
		await db.delete(apps).where(eq(apps.storeId, storeId));
		log.info({ storeId }, "Local apps wiped for full re-import");
		return StoresService.syncApps(storeId);
	}

	static async syncApps(storeId: string) {
		const [store] = await db
			.select()
			.from(stores)
			.where(eq(stores.id, storeId))
			.limit(1);

		if (!store) buildError("notFound", { info: "Store not found" });
		if (!isPublicStore(store) && !store.credentials) {
			buildError("storeConnectionFailed", {
				info: "Store has no credentials",
			});
		}

		// Decrypt outside the try so a locked vault surfaces as its own 423
		// instead of being wrapped into a sync failure.
		let fetchApps: () => Promise<AppData[]>;
		if (isPublicStore(store)) {
			fetchApps = () => StoresService.fetchPublicApps(store);
		} else {
			const credentials = decryptCredentials(
				store.credentials!,
				store.workspaceId,
			);
			const provider = createProvider(store.type as StoreType, credentials);
			fetchApps = () => provider.fetchApps();
		}

		let fetchedApps: Awaited<ReturnType<StoreProvider["fetchApps"]>>;
		try {
			fetchedApps = await fetchApps();
		} catch (err) {
			// Surface broken connections instead of silently staying "connected":
			// the panel renders this status and the user sees the real reason.
			await db
				.update(stores)
				.set({ status: "error" })
				.where(eq(stores.id, storeId));
			log.error({ err, storeId }, "App sync failed — store marked as error");
			buildError("storeApiError", {
				info: `Store sync failed: ${err instanceof Error ? err.message : String(err)}`,
			});
		}

		for (const appData of fetchedApps) {
			// Look up by externalId within the same workspace to handle
			// reconnects where the store row was recreated with a new UUID.
			const existing = await db
				.select({ id: apps.id })
				.from(apps)
				.innerJoin(stores, eq(apps.storeId, stores.id))
				.where(
					and(
						eq(apps.externalId, appData.externalId),
						eq(stores.workspaceId, store.workspaceId),
					),
				)
				.limit(1);

			const appStatus = appData.isDraft ? "draft" : "active";

			if (existing.length > 0) {
				await db
					.update(apps)
					.set({
						bundleId: appData.bundleId,
						iconUrl: appData.iconUrl,
						lastSyncedAt: new Date(),
						name: appData.name,
						platform: appData.platform,
						status: appStatus,
						storeId,
						// Merge, never replace: rawData also holds the import country.
						...(appData.storeFacts
							? {
									rawData: sql`coalesce(${apps.rawData}, '{}'::jsonb) || ${JSON.stringify({ storeFacts: appData.storeFacts })}::jsonb`,
								}
							: {}),
					})
					.where(eq(apps.id, existing[0].id));
			} else {
				await db.insert(apps).values({
					bundleId: appData.bundleId,
					externalId: appData.externalId,
					iconUrl: appData.iconUrl,
					lastSyncedAt: new Date(),
					name: appData.name,
					platform: appData.platform,
					status: appStatus,
					storeId,
					...(appData.storeFacts
						? { rawData: { storeFacts: appData.storeFacts } }
						: {}),
				});
			}
		}

		// Successful sync also recovers stores previously marked as "error".
		await db
			.update(stores)
			.set({ lastSyncedAt: new Date(), status: "connected" })
			.where(eq(stores.id, storeId));

		// Apps imported from a public link re-bind to a real API connection by
		// externalId during sync — drop public connections left with no apps.
		if (!isPublicStore(store)) {
			await StoresService.cleanupEmptyPublicStores(store.workspaceId);
		}

		log.info({ appCount: fetchedApps.length, storeId }, "Apps synced");
		return { synced: fetchedApps.length };
	}

	static async syncAll(workspaceId: string) {
		const connectedStores = await db
			.select()
			.from(stores)
			.where(
				and(
					eq(stores.workspaceId, workspaceId),
					eq(stores.status, "connected"),
				),
			);

		const results: { storeId: string; storeName: string; synced: number }[] =
			[];

		for (const store of connectedStores) {
			const result = await StoresService.syncApps(store.id);
			results.push({
				storeId: store.id,
				storeName: store.name,
				synced: result.synced,
			});
		}

		const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
		log.info(
			{ storeCount: connectedStores.length, totalSynced, workspaceId },
			"All stores synced",
		);

		return { results, totalSynced };
	}

	static getProvider(store: {
		connectionMode: string;
		credentials: string | null;
		type: string;
		workspaceId: string;
	}): StoreProvider {
		return resolveProviderForStore(store);
	}

	/**
	 * Add an app to the workspace from a public store link (or a typeahead
	 * pick), without any API credentials. Creates (or reuses) the workspace's
	 * public connection for that store type and pulls the public listing +
	 * screenshots right away, so the app opens with data.
	 */
	static async importApp(workspaceId: string, input: ImportAppInput) {
		let parsed: ReturnType<typeof parseStoreLink>;
		if (input.url) {
			parsed = parseStoreLink(input.url);
			if (!parsed) {
				buildError("badRequest", {
					info: "Unrecognized store link. Paste an App Store or Google Play listing URL.",
				});
			}
		} else if (input.platform && input.externalId) {
			const type = input.platform === "ios" ? "app_store" : "google_play";
			const bare = parseStoreLink(input.externalId);
			if (!bare || bare.type !== type) {
				buildError("badRequest", {
					info: "Invalid app identifier for the selected platform.",
				});
			}
			parsed = { externalId: bare.externalId, type };
		} else {
			buildError("badRequest", {
				info: "Provide either a store link or a platform with an app identifier.",
			});
		}

		const country = resolveImportCountry(input.country, parsed.country);

		// Validate the app exists publicly and grab metadata for the app row.
		let meta: ResearchAppMeta;
		if (parsed.type === "app_store") {
			meta = await appstoreMeta(parsed.externalId, country);
		} else {
			try {
				meta = await playstoreMeta(parsed.externalId, country);
			} catch {
				buildError("notFound", {
					info: "App not found on Google Play for this country.",
				});
			}
		}

		// Already in the workspace (under any connection) → just point at it.
		const [existing] = await db
			.select({ id: apps.id, storeId: apps.storeId })
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(
				and(
					eq(apps.externalId, parsed.externalId),
					eq(stores.workspaceId, workspaceId),
				),
			)
			.limit(1);
		if (existing) {
			return { appId: existing.id, created: false, storeId: existing.storeId };
		}

		let [publicStore] = await db
			.select()
			.from(stores)
			.where(
				and(
					eq(stores.workspaceId, workspaceId),
					eq(stores.type, parsed.type),
					eq(stores.connectionMode, "public"),
				),
			)
			.limit(1);
		if (!publicStore) {
			[publicStore] = await db
				.insert(stores)
				.values({
					// Store the honest read-only set. Leaving this NULL would resolve
					// to "everything enabled" and report publishing/purchases the
					// connection cannot do. Older public rows stay NULL on purpose -
					// `resolveStoredCapabilities` still tolerates them.
					capabilities: PUBLIC_CONNECTION_CAPABILITIES,
					connectionMode: "public",
					name: `${STORE_TYPE_LABELS[parsed.type]} (public)`,
					status: "connected",
					type: parsed.type,
					workspaceId,
				})
				.returning();
		}

		const [app] = await db
			.insert(apps)
			.values({
				bundleId: meta.bundleId ?? parsed.externalId,
				externalId: parsed.externalId,
				iconUrl: meta.icon,
				lastSyncedAt: new Date(),
				name: meta.title,
				platform: parsed.type === "app_store" ? "ios" : "android",
				rawData: { publicCountry: country, storeFacts: storeFactsFrom(meta) },
				status: "active",
				storeId: publicStore.id,
			})
			.returning();

		// Best effort — a scrape hiccup must not fail the import; the panel can
		// re-sync listings/assets on demand.
		try {
			await ListingsService.syncFromStore(app.id);
			await AssetsService.syncFromStore(app.id);
		} catch (err) {
			log.warn({ appId: app.id, err }, "Initial public sync incomplete");
		}

		// Deep research kicks off in the background: all public reviews, store
		// metadata (pricing/IAP included) and main-keyword positions land in
		// research history moments after the app appears. Skipped under test —
		// it would outlive the stubbed fetch window and hit real stores.
		if (config.NODE_ENV !== "test") {
			void ResearchRunsService.runForApp(app.id, workspaceId, {
				autoKeywords: true,
				country,
				deep: true,
				kind: "scheduled",
			}).catch((err) => {
				log.warn({ appId: app.id, err }, "Post-import research failed");
			});
		}

		await db
			.update(stores)
			.set({ lastSyncedAt: new Date() })
			.where(eq(stores.id, publicStore.id));

		log.info(
			{ appId: app.id, country, externalId: parsed.externalId, workspaceId },
			"App imported from public link",
		);
		return { appId: app.id, created: true, storeId: publicStore.id };
	}

	/**
	 * The apps table is the registry for a public connection — refresh each
	 * app's public metadata, grouped by the country it was imported for.
	 */
	private static async fetchPublicApps(store: {
		id: string;
		type: string;
	}): Promise<AppData[]> {
		const rows = await db
			.select({ externalId: apps.externalId, rawData: apps.rawData })
			.from(apps)
			.where(eq(apps.storeId, store.id));

		const byCountry = new Map<string, string[]>();
		for (const row of rows) {
			const country = publicCountryFor(row);
			const ids = byCountry.get(country) ?? [];
			ids.push(row.externalId);
			byCountry.set(country, ids);
		}

		const fetched: AppData[] = [];
		for (const [country, externalIds] of byCountry) {
			const provider = createPublicProvider(store.type as StoreType, {
				country,
				externalIds,
			});
			fetched.push(...(await provider.fetchApps()));
		}
		return fetched;
	}

	/** Drop public connections whose apps were re-bound to a real API store. */
	private static async cleanupEmptyPublicStores(workspaceId: string) {
		const rows = await db
			.select({ appCount: count(apps.id), id: stores.id })
			.from(stores)
			.leftJoin(apps, eq(apps.storeId, stores.id))
			.where(
				and(
					eq(stores.workspaceId, workspaceId),
					eq(stores.connectionMode, "public"),
				),
			)
			.groupBy(stores.id);

		for (const row of rows) {
			if (row.appCount === 0) {
				await db.delete(stores).where(eq(stores.id, row.id));
				log.info({ storeId: row.id }, "Empty public connection removed");
			}
		}
	}
}

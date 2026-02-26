import Elysia from "elysia";
import { verifyStoreOwnership } from "@/modules/auth/verify-ownership";
import { connectStoreBody, storeIdParams } from "./stores.schema";
import { StoresService } from "./stores.service";

export const storesController = new Elysia({ prefix: "/stores" })
	.post(
		"/connect",
		async ({ body, workspaceId }) => {
			const { store, syncedApps } = await StoresService.connect(
				workspaceId!,
				body.name,
				body.type,
				body.credentials as Record<string, unknown>,
			);
			const warnings: string[] = [];

			if (body.type === "google_play") {
				warnings.push(
					"Draft apps without a package name are not accessible via the Google Play API. Only published apps (or apps with an assigned package name) will be discovered automatically.",
				);

				if (syncedApps === 0) {
					warnings.push(
						'No apps were discovered automatically. If you have apps that should appear, you can provide their package names (e.g. com.example.app) manually in the credentials under the "package_names" field.',
					);
				}
			}

			return {
				store: {
					id: store.id,
					name: store.name,
					status: store.status,
					type: store.type,
				},
				syncedApps,
				warnings,
			};
		},
		{
			body: connectStoreBody,
			detail: { description: "Connect a new store", tags: ["Stores"] },
		},
	)
	.get(
		"/",
		async ({ workspaceId }) => {
			const storesList = await StoresService.list(workspaceId!);
			return {
				stores: storesList.map((s) => ({
					id: s.id,
					lastSyncedAt: s.lastSyncedAt,
					name: s.name,
					status: s.status,
					type: s.type,
				})),
			};
		},
		{
			detail: { description: "List connected stores", tags: ["Stores"] },
		},
	)
	.delete(
		"/:storeId",
		async ({ params, workspaceId }) => {
			return StoresService.disconnect(params.storeId, workspaceId!);
		},
		{
			detail: { description: "Disconnect a store", tags: ["Stores"] },
			params: storeIdParams,
		},
	)
	.post(
		"/sync-all",
		async ({ workspaceId }) => {
			return StoresService.syncAll(workspaceId!);
		},
		{
			detail: {
				description: "Sync apps from all connected stores",
				tags: ["Stores"],
			},
		},
	)
	.post(
		"/:storeId/sync",
		async ({ params, workspaceId }) => {
			await verifyStoreOwnership(params.storeId, workspaceId!);
			return StoresService.syncApps(params.storeId);
		},
		{
			detail: { description: "Force sync apps from store", tags: ["Stores"] },
			params: storeIdParams,
		},
	);

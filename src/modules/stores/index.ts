import Elysia from "elysia";
import { connectStoreBody, storeIdParams } from "./stores.schema";
import { StoresService } from "./stores.service";

export const storesController = new Elysia({ prefix: "/stores" })
	.post(
		"/connect",
		async ({ body }) => {
			const store = await StoresService.connect(
				body.name,
				body.type,
				body.credentials as Record<string, unknown>,
			);
			return {
				store: {
					id: store.id,
					name: store.name,
					status: store.status,
					type: store.type,
				},
			};
		},
		{
			body: connectStoreBody,
			detail: { description: "Connect a new store", tags: ["Stores"] },
		},
	)
	.get(
		"/",
		async () => {
			const storesList = await StoresService.list();
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
		async ({ params }) => {
			return StoresService.disconnect(params.storeId);
		},
		{
			detail: { description: "Disconnect a store", tags: ["Stores"] },
			params: storeIdParams,
		},
	)
	.post(
		"/:storeId/sync",
		async ({ params }) => {
			return StoresService.syncApps(params.storeId);
		},
		{
			detail: { description: "Force sync apps from store", tags: ["Stores"] },
			params: storeIdParams,
		},
	);

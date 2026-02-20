import Elysia from "elysia";
import {
	assetIdParams,
	assetParams,
	assetQuery,
	reorderBody,
	uploadAssetBody,
} from "./assets.schema";
import { AssetsService } from "./assets.service";

export const assetsController = new Elysia({ prefix: "/apps" })
	.get(
		"/:appId/assets",
		async ({ params, query }) => {
			const result = await AssetsService.getAll(params.appId, {
				assetType: query.assetType,
				deviceType: query.deviceType,
				language: query.language,
			});
			return { assets: result };
		},
		{
			detail: {
				description: "Get all assets for an app",
				tags: ["Assets"],
			},
			params: assetParams,
			query: assetQuery,
		},
	)
	.post(
		"/:appId/assets/upload",
		async ({ body, params }) => {
			const fileBuffer = Buffer.from(await body.file.arrayBuffer());
			const asset = await AssetsService.upload(
				params.appId,
				body.language,
				body.assetType,
				body.deviceType,
				fileBuffer,
				body.file.name,
			);
			return { asset };
		},
		{
			body: uploadAssetBody,
			detail: { description: "Upload a new asset", tags: ["Assets"] },
			params: assetParams,
			type: "multipart",
		},
	)
	.delete(
		"/:appId/assets/:assetId",
		async ({ params }) => {
			return AssetsService.deleteAsset(params.appId, params.assetId);
		},
		{
			detail: { description: "Delete an asset", tags: ["Assets"] },
			params: assetIdParams,
		},
	)
	.patch(
		"/:appId/assets/reorder",
		async ({ body }) => {
			const items = body.assetIds.map((id, index) => ({
				id,
				sortOrder: index,
			}));
			return AssetsService.reorder(items);
		},
		{
			body: reorderBody,
			detail: {
				description: "Reorder assets",
				tags: ["Assets"],
			},
			params: assetParams,
		},
	)
	.post(
		"/:appId/assets/sync",
		async ({ params }) => {
			return AssetsService.syncFromStore(params.appId);
		},
		{
			detail: {
				description: "Sync assets from store",
				tags: ["Assets"],
			},
			params: assetParams,
		},
	);

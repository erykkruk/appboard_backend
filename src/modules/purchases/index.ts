import Elysia from "elysia";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { appIdParams, groupIdParams, purchaseIdParams } from "./purchases.schema";
import { PurchasesService } from "./purchases.service";

export const purchasesController = new Elysia({ prefix: "/apps" })
	.post(
		"/:appId/purchases/sync",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PurchasesService.syncPurchases(params.appId, workspaceId!);
		},
		{
			detail: {
				description: "Sync in-app purchases and subscriptions from store",
				tags: ["Purchases"],
			},
			params: appIdParams,
		},
	)
	.get(
		"/:appId/purchases",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const purchases = await PurchasesService.listPurchases(params.appId);
			return { purchases };
		},
		{
			detail: {
				description: "List all in-app purchases for an app",
				tags: ["Purchases"],
			},
			params: appIdParams,
		},
	)
	.get(
		"/:appId/purchases/:purchaseId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const purchase = await PurchasesService.getPurchase(params.purchaseId);
			return { purchase };
		},
		{
			detail: {
				description: "Get a specific in-app purchase",
				tags: ["Purchases"],
			},
			params: purchaseIdParams,
		},
	)
	.get(
		"/:appId/subscription-groups",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const groups = await PurchasesService.listSubscriptionGroups(
				params.appId,
			);
			return { groups };
		},
		{
			detail: {
				description: "List subscription groups for an app",
				tags: ["Purchases"],
			},
			params: appIdParams,
		},
	)
	.get(
		"/:appId/subscription-groups/:groupId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const group = await PurchasesService.getSubscriptionGroup(
				params.groupId,
			);
			return { group };
		},
		{
			detail: {
				description: "Get a specific subscription group with subscriptions",
				tags: ["Purchases"],
			},
			params: groupIdParams,
		},
	);

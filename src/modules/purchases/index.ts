import Elysia from "elysia";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import {
	appIdParams,
	createGroupBody,
	createPurchaseBody,
	createSubscriptionBody,
	groupIdParams,
	purchaseIdParams,
	subscriptionInGroupParams,
	updatePurchaseBody,
} from "./purchases.schema";
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
	.post(
		"/:appId/purchases",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const purchase = await PurchasesService.createPurchase(
				params.appId,
				workspaceId!,
				body,
			);
			return { purchase };
		},
		{
			body: createPurchaseBody,
			detail: {
				description: "Create a new in-app purchase",
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
	.patch(
		"/:appId/purchases/:purchaseId",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const purchase = await PurchasesService.updatePurchase(
				params.purchaseId,
				workspaceId!,
				body,
			);
			return { purchase };
		},
		{
			body: updatePurchaseBody,
			detail: {
				description: "Update an in-app purchase",
				tags: ["Purchases"],
			},
			params: purchaseIdParams,
		},
	)
	.delete(
		"/:appId/purchases/:purchaseId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			await PurchasesService.deletePurchase(params.purchaseId, workspaceId!);
			return { success: true };
		},
		{
			detail: {
				description: "Delete an in-app purchase",
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
	.post(
		"/:appId/subscription-groups",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const group = await PurchasesService.createGroup(
				params.appId,
				workspaceId!,
				body.name,
			);
			return { group };
		},
		{
			body: createGroupBody,
			detail: {
				description: "Create a subscription group",
				tags: ["Purchases"],
			},
			params: appIdParams,
		},
	)
	.get(
		"/:appId/subscription-groups/:groupId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const group = await PurchasesService.getSubscriptionGroup(params.groupId);
			return { group };
		},
		{
			detail: {
				description: "Get a specific subscription group with subscriptions",
				tags: ["Purchases"],
			},
			params: groupIdParams,
		},
	)
	.post(
		"/:appId/subscription-groups/:groupId/subscriptions",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const purchase = await PurchasesService.createSubscription(
				params.appId,
				workspaceId!,
				params.groupId,
				body,
			);
			return { purchase };
		},
		{
			body: createSubscriptionBody,
			detail: {
				description: "Create a subscription in a group",
				tags: ["Purchases"],
			},
			params: subscriptionInGroupParams,
		},
	);

import Elysia from "elysia";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import {
	appIdParams,
	createGroupBody,
	createPurchaseBody,
	createSubscriptionBody,
	groupIdParams,
	groupLocLanguageParams,
	purchaseIdParams,
	subscriptionInGroupParams,
	updateAvailabilityBody,
	updateFamilySharingBody,
	updateGroupBody,
	updatePurchaseBody,
	updateSubscriptionAvailabilityBody,
	updateUseGroupLocalizationsBody,
	upsertGroupLocalizationsBody,
	upsertGroupReviewInfoBody,
	upsertPurchaseReviewInfoBody,
} from "./purchases.schema";
import { PurchasesService } from "./purchases.service";

export const purchasesController = new Elysia({ prefix: "/apps" })
	.get(
		"/:appId/purchases/capabilities",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PurchasesService.checkMonetizationSupport(
				params.appId,
				workspaceId!,
			);
		},
		{
			detail: {
				description:
					"Check if the store supports monetization (IAP/subscription management)",
				tags: ["Purchases"],
			},
			params: appIdParams,
		},
	)
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
	.post(
		"/:appId/purchases/publish",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PurchasesService.publishPurchases(params.appId, workspaceId!);
		},
		{
			detail: {
				description:
					"Publish all purchase data (prices, localizations, availability) to store",
				tags: ["Purchases"],
			},
			params: appIdParams,
		},
	)
	.get(
		"/:appId/purchases",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const purchases = await PurchasesService.listPurchases(
				params.appId,
				workspaceId!,
			);
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
			const purchase = await PurchasesService.getPurchase(
				params.purchaseId,
				workspaceId!,
			);
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
				workspaceId!,
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
			const group = await PurchasesService.getSubscriptionGroup(
				params.groupId,
				workspaceId!,
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
	)
	.patch(
		"/:appId/subscription-groups/:groupId",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const group = await PurchasesService.updateGroup(
				params.groupId,
				params.appId,
				workspaceId!,
				body,
			);
			return { group };
		},
		{
			body: updateGroupBody,
			detail: {
				description: "Update a subscription group",
				tags: ["Purchases"],
			},
			params: groupIdParams,
		},
	)
	.delete(
		"/:appId/subscription-groups/:groupId",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			await PurchasesService.deleteGroup(
				params.groupId,
				params.appId,
				workspaceId!,
			);
			return { success: true };
		},
		{
			detail: {
				description: "Delete a subscription group",
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
	)
	// ── Group Localizations ──────────────────────────────────────
	.get(
		"/:appId/subscription-groups/:groupId/localizations",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			await PurchasesService.verifyGroupOwnership(params.groupId, params.appId);
			const localizations = await PurchasesService.listGroupLocalizations(
				params.groupId,
			);
			return { localizations };
		},
		{
			detail: {
				description: "List localizations for a subscription group",
				tags: ["Purchases"],
			},
			params: groupIdParams,
		},
	)
	.put(
		"/:appId/subscription-groups/:groupId/localizations",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			await PurchasesService.verifyGroupOwnership(params.groupId, params.appId);
			const localizations = await PurchasesService.upsertGroupLocalizations(
				params.groupId,
				params.appId,
				workspaceId!,
				body.localizations,
			);
			return { localizations };
		},
		{
			body: upsertGroupLocalizationsBody,
			detail: {
				description: "Upsert localizations for a subscription group",
				tags: ["Purchases"],
			},
			params: groupIdParams,
		},
	)
	.delete(
		"/:appId/subscription-groups/:groupId/localizations/:language",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			await PurchasesService.verifyGroupOwnership(params.groupId, params.appId);
			await PurchasesService.deleteGroupLocalization(
				params.groupId,
				params.appId,
				workspaceId!,
				params.language,
			);
			return { success: true };
		},
		{
			detail: {
				description: "Delete a localization from a subscription group",
				tags: ["Purchases"],
			},
			params: groupLocLanguageParams,
		},
	)
	// ── Group Availability ───────────────────────────────────────
	.get(
		"/:appId/subscription-groups/:groupId/availability",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			await PurchasesService.verifyGroupOwnership(params.groupId, params.appId);
			return PurchasesService.getGroupAvailability(params.groupId);
		},
		{
			detail: {
				description: "Get available territories for a subscription group",
				tags: ["Purchases"],
			},
			params: groupIdParams,
		},
	)
	.put(
		"/:appId/subscription-groups/:groupId/availability",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			await PurchasesService.verifyGroupOwnership(params.groupId, params.appId);
			return PurchasesService.updateGroupAvailability(
				params.groupId,
				params.appId,
				workspaceId!,
				body.territories,
			);
		},
		{
			body: updateAvailabilityBody,
			detail: {
				description: "Update available territories for a subscription group",
				tags: ["Purchases"],
			},
			params: groupIdParams,
		},
	)
	// ── Group Review Info ────────────────────────────────────────
	.get(
		"/:appId/subscription-groups/:groupId/review-info",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			await PurchasesService.verifyGroupOwnership(params.groupId, params.appId);
			const reviewInfo = await PurchasesService.getGroupReviewInfo(
				params.groupId,
			);
			return { reviewInfo };
		},
		{
			detail: {
				description: "Get review info for a subscription group",
				tags: ["Purchases"],
			},
			params: groupIdParams,
		},
	)
	.put(
		"/:appId/subscription-groups/:groupId/review-info",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			await PurchasesService.verifyGroupOwnership(params.groupId, params.appId);
			const reviewInfo = await PurchasesService.upsertGroupReviewInfo(
				params.groupId,
				body,
			);
			return { reviewInfo };
		},
		{
			body: upsertGroupReviewInfoBody,
			detail: {
				description: "Upsert review info for a subscription group",
				tags: ["Purchases"],
			},
			params: groupIdParams,
		},
	)
	// ── Subscription Availability Override ────────────────────────
	.get(
		"/:appId/purchases/:purchaseId/availability",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PurchasesService.getSubscriptionAvailability(params.purchaseId);
		},
		{
			detail: {
				description:
					"Get available territories for a purchase (null = group default)",
				tags: ["Purchases"],
			},
			params: purchaseIdParams,
		},
	)
	.put(
		"/:appId/purchases/:purchaseId/availability",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PurchasesService.updateSubscriptionAvailability(
				params.purchaseId,
				params.appId,
				workspaceId!,
				body.territories,
			);
		},
		{
			body: updateSubscriptionAvailabilityBody,
			detail: {
				description:
					"Update available territories for a purchase (null = reset to group default)",
				tags: ["Purchases"],
			},
			params: purchaseIdParams,
		},
	)
	// ── Subscription Review Info Override ─────────────────────────
	.get(
		"/:appId/purchases/:purchaseId/review-info",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const reviewInfo = await PurchasesService.getSubscriptionReviewInfo(
				params.purchaseId,
			);
			return { reviewInfo };
		},
		{
			detail: {
				description: "Get review info for a purchase",
				tags: ["Purchases"],
			},
			params: purchaseIdParams,
		},
	)
	.put(
		"/:appId/purchases/:purchaseId/review-info",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const reviewInfo = await PurchasesService.upsertSubscriptionReviewInfo(
				params.purchaseId,
				body,
			);
			return { reviewInfo };
		},
		{
			body: upsertPurchaseReviewInfoBody,
			detail: {
				description: "Upsert review info for a purchase",
				tags: ["Purchases"],
			},
			params: purchaseIdParams,
		},
	)
	// ── Effective Localizations ──────────────────────────────────
	.get(
		"/:appId/purchases/:purchaseId/effective-localizations",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PurchasesService.getEffectiveLocalizations(params.purchaseId);
		},
		{
			detail: {
				description:
					"Get effective localizations (own or inherited from group)",
				tags: ["Purchases"],
			},
			params: purchaseIdParams,
		},
	)
	.put(
		"/:appId/purchases/:purchaseId/use-group-localizations",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PurchasesService.updateUseGroupLocalizations(
				params.purchaseId,
				body.useGroupLocalizations,
			);
		},
		{
			body: updateUseGroupLocalizationsBody,
			detail: {
				description: "Toggle whether this purchase uses group localizations",
				tags: ["Purchases"],
			},
			params: purchaseIdParams,
		},
	)
	// ── Family Sharing ───────────────────────────────────────────
	.patch(
		"/:appId/purchases/:purchaseId/family-sharing",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const purchase = await PurchasesService.updateFamilySharing(
				params.purchaseId,
				params.appId,
				workspaceId!,
				body.familySharable,
			);
			return { purchase };
		},
		{
			body: updateFamilySharingBody,
			detail: {
				description: "Toggle family sharing for a purchase",
				tags: ["Purchases"],
			},
			params: purchaseIdParams,
		},
	);

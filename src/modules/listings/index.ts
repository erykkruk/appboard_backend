import Elysia, { t } from "elysia";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import {
	exportQuery,
	listingLanguageParams,
	listingParams,
	translateFieldBody,
	updateCategoriesBody,
	updateListingBody,
} from "./listings.schema";
import { ListingsService } from "./listings.service";

export const listingsController = new Elysia({ prefix: "/apps" })
	.get(
		"/:appId/listings/template",
		async ({ params, query, set, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const format = query.format;
			const content = ListingsService.generateTemplate(format);
			const ext = format === "json" ? "json" : "csv";
			const mime = format === "json" ? "application/json" : "text/csv";

			set.headers["content-type"] = `${mime}; charset=utf-8`;
			set.headers["content-disposition"] =
				`attachment; filename="listings-template.${ext}"`;
			return content;
		},
		{
			detail: {
				description: "Download empty listings template",
				tags: ["Listings"],
			},
			params: listingParams,
			query: exportQuery,
		},
	)
	.get(
		"/:appId/listings/export",
		async ({ params, query, set, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const format = query.format;
			const content = await ListingsService.exportListings(
				params.appId,
				format,
			);
			const ext = format === "json" ? "json" : "csv";
			const mime = format === "json" ? "application/json" : "text/csv";

			set.headers["content-type"] = `${mime}; charset=utf-8`;
			set.headers["content-disposition"] =
				`attachment; filename="listings-export.${ext}"`;
			return content;
		},
		{
			detail: {
				description: "Export listings as CSV or JSON",
				tags: ["Listings"],
			},
			params: listingParams,
			query: exportQuery,
		},
	)
	.post(
		"/:appId/listings/import",
		async ({ params, body, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return ListingsService.importListings(params.appId, body.file);
		},
		{
			body: t.Object({
				file: t.File(),
			}),
			detail: {
				description: "Import listings from CSV or JSON file",
				tags: ["Listings"],
			},
			params: listingParams,
		},
	)
	.get(
		"/:appId/listings/diffs",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const diffs = await ListingsService.getDraftDiffs(params.appId);
			return { diffs };
		},
		{
			detail: {
				description:
					"Get per-language per-field diff between draft and remote listings",
				tags: ["Listings"],
			},
			params: listingParams,
		},
	)
	.get(
		"/:appId/listings",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const result = await ListingsService.getAll(params.appId);
			return { listings: result };
		},
		{
			detail: {
				description: "Get all listings for an app",
				tags: ["Listings"],
			},
			params: listingParams,
		},
	)
	.get(
		"/:appId/listings/:language",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return ListingsService.getByLanguage(params.appId, params.language);
		},
		{
			detail: {
				description: "Get listing for specific language",
				tags: ["Listings"],
			},
			params: listingLanguageParams,
		},
	)
	.put(
		"/:appId/listings/:language",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const draft = await ListingsService.updateDraft(
				params.appId,
				params.language,
				body,
			);
			return { listing: draft };
		},
		{
			body: updateListingBody,
			detail: {
				description: "Auto-save listing draft to local DB",
				tags: ["Listings"],
			},
			params: listingLanguageParams,
		},
	)
	.post(
		"/:appId/listings/publish",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return ListingsService.publish(params.appId);
		},
		{
			detail: {
				description: "Publish listing changes to store",
				tags: ["Listings"],
			},
			params: listingParams,
		},
	)
	.post(
		"/:appId/listings/sync",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return ListingsService.syncFromStore(params.appId);
		},
		{
			detail: {
				description: "Sync listings from store",
				tags: ["Listings"],
			},
			params: listingParams,
		},
	)
	.post(
		"/:appId/listings/translate-from/:language",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return ListingsService.translateFromLanguage(
				workspaceId!,
				params.appId,
				params.language,
			);
		},
		{
			detail: {
				description:
					"Translate all listing fields from source language to all other languages",
				tags: ["Listings"],
			},
			params: listingLanguageParams,
		},
	)
	.post(
		"/:appId/listings/translate-field-from/:language",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return ListingsService.translateFieldFromLanguage(
				workspaceId!,
				params.appId,
				params.language,
				body.field,
			);
		},
		{
			body: translateFieldBody,
			detail: {
				description:
					"Translate a single listing field from source language to all other languages",
				tags: ["Listings"],
			},
			params: listingLanguageParams,
		},
	)
	.get(
		"/:appId/listings/categories",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return ListingsService.getCategories(params.appId);
		},
		{
			detail: {
				description: "Get app categories (primary + secondary)",
				tags: ["Listings"],
			},
			params: listingParams,
		},
	)
	.put(
		"/:appId/listings/categories",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return ListingsService.updateCategories(
				params.appId,
				body.primaryCategory,
				body.secondaryCategory,
			);
		},
		{
			body: updateCategoriesBody,
			detail: {
				description: "Auto-save categories to local DB",
				tags: ["Listings"],
			},
			params: listingParams,
		},
	)
	.post(
		"/:appId/listings/categories/publish",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return ListingsService.publishCategories(params.appId);
		},
		{
			detail: {
				description: "Publish categories to store",
				tags: ["Listings"],
			},
			params: listingParams,
		},
	);

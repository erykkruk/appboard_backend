import Elysia, { t } from "elysia";
import {
	exportQuery,
	listingLanguageParams,
	listingParams,
	updateListingBody,
} from "./listings.schema";
import { ListingsService } from "./listings.service";

export const listingsController = new Elysia({ prefix: "/apps" })
	.get(
		"/:appId/listings/template",
		({ params, query, set }) => {
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
		async ({ params, query, set }) => {
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
		async ({ params, body }) => {
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
		"/:appId/listings",
		async ({ params }) => {
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
		async ({ params }) => {
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
		async ({ body, params }) => {
			const draft = await ListingsService.updateDraft(
				params.appId,
				params.language,
				body as Record<string, string | undefined>,
			);
			return { listing: draft };
		},
		{
			body: updateListingBody,
			detail: {
				description: "Update listing draft",
				tags: ["Listings"],
			},
			params: listingLanguageParams,
		},
	)
	.post(
		"/:appId/listings/publish",
		async ({ params }) => {
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
		async ({ params }) => {
			return ListingsService.syncFromStore(params.appId);
		},
		{
			detail: {
				description: "Sync listings from store",
				tags: ["Listings"],
			},
			params: listingParams,
		},
	);

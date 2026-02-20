import Elysia from "elysia";
import {
	listingLanguageParams,
	listingParams,
	updateListingBody,
} from "./listings.schema";
import { ListingsService } from "./listings.service";

export const listingsController = new Elysia({ prefix: "/apps" })
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

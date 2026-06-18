import { z } from "zod";
import type { AppBoardClient } from "./client";

/**
 * A single MCP tool: a zod input schema plus a handler that calls the backend
 * via the typed treaty client and returns a JSON-serialisable result. `Shape`
 * is the tool's own input shape, used to strongly type its handler.
 */
export type McpTool<Shape extends z.ZodRawShape = z.ZodRawShape> = {
	description: string;
	handler: (
		client: AppBoardClient,
		input: z.infer<z.ZodObject<Shape>>,
	) => Promise<unknown>;
	inputSchema: Shape;
	name: string;
};

/**
 * Shape-erased tool, as stored in the registry. The handler accepts `unknown`
 * input because the MCP SDK validates it against `inputSchema` before calling.
 */
export type RegisteredTool = {
	description: string;
	handler: (client: AppBoardClient, input: unknown) => Promise<unknown>;
	inputSchema: z.ZodRawShape;
	name: string;
};

/**
 * Preserve each tool's input-shape generic at the definition site so its
 * handler `input` is strongly typed, then erase it for uniform registry
 * storage. The erasure is sound: the SDK parses input against `inputSchema`.
 */
function defineTool<Shape extends z.ZodRawShape>(
	tool: McpTool<Shape>,
): RegisteredTool {
	return tool as unknown as RegisteredTool;
}

/** Eden treaty resolves every call to `{ data, error, status }`. */
type TreatyResponse<T> = {
	data: T | null;
	error: { status?: number; value?: unknown } | null;
	status?: number;
};

/**
 * Unwrap a treaty response: return `data` on success, or throw a readable error
 * carrying the backend status and body so MCP clients see why a call failed.
 */
function unwrap<T>(response: TreatyResponse<T>): T {
	if (response.error) {
		const status = response.error.status ?? response.status ?? 0;
		const value = response.error.value;
		const detail =
			typeof value === "string" ? value : JSON.stringify(value ?? {});
		throw new Error(`AppBoard API error (${status}): ${detail}`);
	}
	return response.data as T;
}

const appIdSchema = z.string().describe("App UUID");
const languageSchema = z
	.string()
	.min(2)
	.describe("BCP-47 language/locale code, e.g. en-US");
const platformSchema = z
	.string()
	.describe("Store platform, e.g. ios or android");

const listingFieldSchema = z
	.enum([
		"title",
		"subtitle",
		"shortDescription",
		"description",
		"fullDescription",
		"keywords",
		"promotionalText",
		"whatsNew",
	])
	.describe("Listing field to generate");

/**
 * The full MCP tool registry. Each handler mirrors the request/response shape of
 * the matching REST endpoint so AI agents can drive ASO operations end to end.
 */
export const tools: RegisteredTool[] = [
	defineTool({
		description: "List all apps in the workspace, optionally filtered.",
		handler: (client, input) =>
			client.api.apps
				.get({
					query: {
						...(input.platform ? { platform: input.platform } : {}),
						...(input.storeId ? { storeId: input.storeId } : {}),
					},
				})
				.then(unwrap),
		inputSchema: {
			platform: z
				.string()
				.optional()
				.describe("Filter by platform (ios/android)"),
			storeId: z.string().optional().describe("Filter by store UUID"),
		},
		name: "apps_list",
	}),
	defineTool({
		description: "Get details for a single app by its UUID.",
		handler: (client, input) =>
			client.api.apps({ appId: input.appId }).get().then(unwrap),
		inputSchema: { appId: appIdSchema },
		name: "apps_get",
	}),
	defineTool({
		description: "List all localized listings for an app.",
		handler: (client, input) =>
			client.api.apps({ appId: input.appId }).listings.get().then(unwrap),
		inputSchema: { appId: appIdSchema },
		name: "listings_list",
	}),
	defineTool({
		description:
			"Update the draft listing for one language (auto-saved locally; " +
			"publish separately). Only provided fields are changed.",
		handler: (client, input) => {
			const { appId, language, ...body } = input;
			return client.api
				.apps({ appId })
				.listings({ language })
				.put(body)
				.then(unwrap);
		},
		inputSchema: {
			appId: appIdSchema,
			doNotTranslateFields: z
				.array(z.string())
				.optional()
				.describe("Field names that must not be auto-translated"),
			fullDesc: z.string().optional(),
			keywords: z.string().max(255).optional(),
			language: languageSchema,
			marketingUrl: z.string().max(1024).optional(),
			privacyUrl: z.string().max(1024).optional(),
			promoText: z.string().max(255).optional(),
			shortDesc: z.string().max(255).optional(),
			supportUrl: z.string().max(1024).optional(),
			title: z.string().max(255).optional(),
			translationInstructions: z.string().optional(),
			videoUrl: z.string().max(1024).optional(),
			whatsNew: z.string().optional(),
		},
		name: "listings_update_draft",
	}),
	defineTool({
		description:
			"Translate every listing field from a source language into all other " +
			"languages. Respects Do Not Translate fields configured on the draft.",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				.listings["translate-from"]({ language: input.language })
				.post()
				.then(unwrap),
		inputSchema: {
			appId: appIdSchema,
			language: languageSchema.describe("Source language to translate from"),
		},
		name: "listings_translate_from",
	}),
	defineTool({
		description: "Suggest ASO keywords for an app using AI.",
		handler: (client, input) =>
			client.api.ai["suggest-keywords"]
				.post({
					appName: input.appName,
					...(input.category ? { category: input.category } : {}),
					...(input.currentKeywords
						? { currentKeywords: input.currentKeywords }
						: {}),
					...(input.description ? { description: input.description } : {}),
				})
				.then(unwrap),
		inputSchema: {
			appName: z.string().min(1),
			category: z.string().optional(),
			currentKeywords: z.array(z.string()).optional(),
			description: z.string().optional(),
		},
		name: "ai_suggest_keywords",
	}),
	defineTool({
		description:
			"Translate localization fields for an app with ASO context using AI.",
		handler: (client, input) =>
			client.api.ai["translate-localization"]
				.post({
					appId: input.appId,
					appName: input.appName,
					fields: input.fields,
					platform: input.platform,
					sourceLanguage: input.sourceLanguage,
					targetLanguage: input.targetLanguage,
					...(input.instructions ? { instructions: input.instructions } : {}),
				})
				.then(unwrap),
		inputSchema: {
			appId: appIdSchema,
			appName: z.string().min(1),
			fields: z
				.record(z.string(), z.string())
				.describe("Map of field name -> source text to translate"),
			instructions: z
				.string()
				.optional()
				.describe("Extra translation guidance"),
			platform: platformSchema,
			sourceLanguage: languageSchema,
			targetLanguage: languageSchema,
		},
		name: "ai_translate_localization",
	}),
	defineTool({
		description: "Generate release notes (What's New) for a version using AI.",
		handler: (client, input) =>
			client.api.ai["generate-release-notes"]
				.post({
					appName: input.appName,
					changes: input.changes,
					version: input.version,
				})
				.then(unwrap),
		inputSchema: {
			appName: z.string().min(1),
			changes: z
				.array(z.string().min(1))
				.describe("Bullet list of changes in this release"),
			version: z.string().min(1).describe("Version string, e.g. 1.2.0"),
		},
		name: "ai_generate_release_notes",
	}),
	defineTool({
		description:
			"Generate or rephrase a single listing field (title, description, " +
			"keywords, etc.) for one language using AI.",
		handler: (client, input) =>
			client.api.ai["generate-listing-field"]
				.post({
					appId: input.appId,
					appName: input.appName,
					field: input.field,
					language: input.language,
					platform: input.platform,
					...(input.currentValue ? { currentValue: input.currentValue } : {}),
				})
				.then(unwrap),
		inputSchema: {
			appId: appIdSchema,
			appName: z.string().min(1),
			currentValue: z
				.string()
				.optional()
				.describe("Existing value to rephrase, if any"),
			field: listingFieldSchema,
			language: languageSchema,
			platform: platformSchema,
		},
		name: "ai_generate_listing_field",
	}),
	defineTool({
		description: "List reviews for an app, with optional filters.",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				.reviews.get({
					query: {
						...(input.hasReply !== undefined
							? { hasReply: input.hasReply }
							: {}),
						...(input.language ? { language: input.language } : {}),
						...(input.rating !== undefined ? { rating: input.rating } : {}),
						...(input.storeType ? { storeType: input.storeType } : {}),
					},
				})
				.then(unwrap),
		inputSchema: {
			appId: appIdSchema,
			hasReply: z
				.boolean()
				.optional()
				.describe("Filter by whether a reply exists"),
			language: z.string().optional(),
			rating: z.number().min(1).max(5).optional(),
			storeType: z
				.string()
				.optional()
				.describe("Filter by store type (e.g. app_store, google_play)"),
		},
		name: "reviews_list",
	}),
	defineTool({
		description: "Reply to a review by its UUID.",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				.reviews({ reviewId: input.reviewId })
				.reply.post({ text: input.text })
				.then(unwrap),
		inputSchema: {
			appId: appIdSchema,
			reviewId: z.string().describe("Review UUID"),
			text: z.string().min(1).describe("Reply text"),
		},
		name: "reviews_reply",
	}),
	defineTool({
		description: "List all in-app purchases for an app.",
		handler: (client, input) =>
			client.api.apps({ appId: input.appId }).purchases.get().then(unwrap),
		inputSchema: { appId: appIdSchema },
		name: "purchases_list",
	}),
	defineTool({
		description:
			"Validate a screenshot's dimensions against the accepted preset(s) " +
			"for a display type. Provide the image as a base64 data URL or raw " +
			"base64 string.",
		handler: (client, input) => {
			const file = base64ToFile(
				input.fileBase64,
				input.fileName ?? "screenshot.png",
				input.mimeType ?? "image/png",
			);
			return client.api
				.apps({ appId: input.appId })
				.publishing.screenshots.validate.post({
					displayType: input.displayType,
					file,
				})
				.then(unwrap);
		},
		inputSchema: {
			appId: appIdSchema,
			displayType: z
				.string()
				.min(1)
				.describe("Display type, e.g. APP_IPHONE_67"),
			fileBase64: z
				.string()
				.min(1)
				.describe("Screenshot bytes as base64 (optionally a data URL)"),
			fileName: z.string().optional(),
			mimeType: z.string().optional().describe("Defaults to image/png"),
		},
		name: "publishing_validate_screenshot",
	}),
	defineTool({
		description:
			"Publish all pending changes for an app to the store, optionally " +
			"submitting for review.",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				.publishing.publish.post({
					...(input.submitForReview !== undefined
						? { submitForReview: input.submitForReview }
						: {}),
				})
				.then(unwrap),
		inputSchema: {
			appId: appIdSchema,
			submitForReview: z
				.boolean()
				.optional()
				.describe("Also submit the app for store review after publishing"),
		},
		name: "publishing_publish",
	}),
];

/**
 * Decode a base64 (or data-URL) string into a File the treaty multipart client
 * can upload. Screenshots arrive as text over MCP, so we rehydrate them here.
 */
function base64ToFile(input: string, name: string, mimeType: string): File {
	const base64 = input.includes(",")
		? input.slice(input.indexOf(",") + 1)
		: input;
	const bytes = Buffer.from(base64, "base64");
	return new File([bytes], name, { type: mimeType });
}

/** Quick lookup of a tool by name. */
export function getTool(name: string): RegisteredTool | undefined {
	return tools.find((tool) => tool.name === name);
}

/** All registered tool names, useful for tests and docs. */
export const toolNames = tools.map((tool) => tool.name);

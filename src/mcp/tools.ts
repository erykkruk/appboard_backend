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
const reviewScopeSchema = z
	.enum(["app", "group"])
	.optional()
	.describe(
		"app (default) = this app only; group = every app of its app group",
	);
const languageSchema = z
	.string()
	.min(2)
	.describe("BCP-47 language/locale code, e.g. en-US");
const countrySchema = z
	.string()
	.regex(/^[A-Za-z]{2}$/)
	.describe("Two-letter store country code, e.g. us, pl, de");
const devicesSchema = z
	.array(z.enum(["phone", "tablet", "tv"]))
	.min(1)
	.describe('Form factors of the store record, e.g. ["tv"] or ["phone", "tv"]');
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
						...(input.country ? { country: input.country } : {}),
						...(input.scope ? { scope: input.scope } : {}),
					},
				})
				.then(unwrap),
		inputSchema: {
			appId: appIdSchema,
			country: z
				.string()
				.length(2)
				.optional()
				.describe("Filter by storefront country (ISO alpha-2, e.g. pl, us)"),
			hasReply: z
				.boolean()
				.optional()
				.describe("Filter by whether a reply exists"),
			language: z.string().optional(),
			rating: z.number().min(1).max(5).optional(),
			scope: reviewScopeSchema,
			storeType: z
				.string()
				.optional()
				.describe("Filter by store type (e.g. app_store, google_play)"),
		},
		name: "reviews_list",
	}),
	defineTool({
		description:
			"Store ratings of an app: every star rating (star-only included) " +
			"per store (App Store, Google Play) and per country, with average, " +
			"rating count, reviews with text and histogram (Google Play), plus " +
			"the total over all countries (weighted average). scope=group sums " +
			"the app group (e.g. the iPhone and Android apps of one product); a " +
			"listing shared by two records counts once. Refreshed daily.",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				.reviews.ratings.get({
					query: input.scope ? { scope: input.scope } : {},
				})
				.then(unwrap),
		inputSchema: {
			appId: appIdSchema,
			scope: reviewScopeSchema,
		},
		name: "reviews_ratings_summary",
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
		description:
			"Score up to 10 App Store keywords for ASO targeting: search " +
			"popularity (1-100, calibrated to Apple's scale), competition " +
			"difficulty with a sub-score breakdown and Top 5/10/20 ranking " +
			"tiers, opportunity score, targeting classification (sweet-spot, " +
			"hidden-gem, ...) and estimated daily downloads per ranking " +
			"position. Requires the RESEARCH feature to be enabled.",
		handler: (client, input) =>
			client.api.research["keyword-scores"]
				.post({
					country: input.country,
					keywords: input.keywords,
					...(input.appstoreId ? { appstoreId: input.appstoreId } : {}),
				})
				.then(unwrap),
		inputSchema: {
			appstoreId: z
				.string()
				.optional()
				.describe(
					"App Store track id of your own app - adds its search rank per keyword",
				),
			country: z
				.string()
				.length(2)
				.describe("Two-letter App Store country code, e.g. us, pl"),
			keywords: z
				.array(z.string().min(1))
				.min(1)
				.max(10)
				.describe("Keywords to score (max 10 per call)"),
		},
		name: "research_keyword_scores",
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
	// Store import + devices
	defineTool({
		description:
			"Add an app to the workspace from a public store link (App Store or " +
			"Google Play URL, bare Apple id or Android package name) - no store " +
			"API credentials needed. Pass devices to mark form factors: " +
			'["tv"] for an Android TV package (e.g. its own Play package), ' +
			'["phone", "tv"] for an iOS app that also ships on Apple TV. ' +
			"Re-importing an existing app with devices updates them.",
		handler: (client, input) =>
			client.api.stores.import
				.post({
					...(input.url ? { url: input.url } : {}),
					...(input.platform ? { platform: input.platform } : {}),
					...(input.externalId ? { externalId: input.externalId } : {}),
					...(input.country ? { country: input.country } : {}),
					...(input.devices ? { devices: input.devices } : {}),
				})
				.then(unwrap),
		inputSchema: {
			country: countrySchema
				.optional()
				.describe(
					"Storefront to read the listing from (defaults to the link's, else us)",
				),
			devices: devicesSchema.optional(),
			externalId: z
				.string()
				.min(1)
				.optional()
				.describe("Apple numeric id or Android package name (with platform)"),
			platform: z
				.enum(["ios", "android"])
				.optional()
				.describe("Required together with externalId"),
			url: z
				.string()
				.min(1)
				.optional()
				.describe(
					"Store listing URL, e.g. https://play.google.com/store/apps/details?id=com.example.tv",
				),
		},
		name: "stores_import_app",
	}),
	defineTool({
		description:
			"Set the form factors an app's store record serves (phone, tablet, tv). " +
			"A tvOS-only App Store record cannot be rank-tracked: Apple has no " +
			"public Apple TV search.",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				.patch({ devices: input.devices })
				.then(unwrap),
		inputSchema: { appId: appIdSchema, devices: devicesSchema },
		name: "apps_update_devices",
	}),
	// Rank tracking
	defineTool({
		description:
			"Per-market rank overview of an app: for every country with tracked " +
			"keywords - tracked / measured / ranked counts, top 10 and top 50, " +
			"median, average and best position, improved / declined / entered / " +
			"dropped since the previous measurement, failed lookups in the last " +
			"run, last check time, starred keywords and starred in the top 10. " +
			"Also totals, the latest rank-check run and " +
			"whether the store can be rank-tracked (rankTracking.supported).",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				.tracking.markets.get()
				.then(unwrap),
		inputSchema: { appId: appIdSchema },
		name: "tracking_get_markets",
	}),
	defineTool({
		description:
			"The tracker board for ONE market: per keyword position, previous " +
			"position, delta, best position, difficulty/popularity, the phrase " +
			"leader, which listing fields carry it and starred (one of the " +
			"team's own target keywords); plus movement, runs and metadata " +
			"gaps. Omit country to get the first tracked market.",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				.tracking.board.get({
					query: input.country ? { country: input.country } : {},
				})
				.then(unwrap),
		inputSchema: {
			appId: appIdSchema,
			country: countrySchema.optional(),
		},
		name: "tracking_get_board",
	}),
	defineTool({
		description:
			"Track keywords in many markets at once: items = [{ country, " +
			"keywords[] }] (up to 250 markets, 100 keywords each per call). " +
			"Keywords are lowercased and deduped; each market holds at most 80. " +
			"Returns per market what was added, skipped (already tracked) and " +
			"rejected (over the cap) - the call never fails as a whole on the cap.",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				.tracking.keywords.bulk.post({ items: input.items })
				.then(unwrap),
		inputSchema: {
			appId: appIdSchema,
			items: z
				.array(
					z.object({
						country: countrySchema,
						keywords: z.array(z.string().min(1).max(255)).min(1).max(100),
					}),
				)
				.min(1)
				.max(250)
				.describe("Markets and their keywords"),
		},
		name: "tracking_add_keywords",
	}),
	defineTool({
		description:
			"Star (or unstar with starred: false) tracked keywords as the team's " +
			"own targets: items = [{ country, keywords[] }]. The app UI can " +
			"filter to starred keywords and charts them by default. Starring " +
			"never tracks: phrases not tracked in a market come back under " +
			"notTracked (add them with tracking_add_keywords first).",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				.tracking.keywords.patch({
					items: input.items,
					starred: input.starred ?? true,
				})
				.then(unwrap),
		inputSchema: {
			appId: appIdSchema,
			items: z
				.array(
					z.object({
						country: countrySchema,
						keywords: z.array(z.string().min(1).max(255)).min(1).max(100),
					}),
				)
				.min(1)
				.max(250)
				.describe("Markets and their keywords"),
			starred: z
				.boolean()
				.optional()
				.describe("true (default) to star, false to unstar"),
		},
		name: "tracking_star_keywords",
	}),
	defineTool({
		description:
			"Stop tracking one keyword: pass keywordId, or country + keyword. " +
			"Its measured history stays on the board.",
		handler: async (client, input) => {
			let keywordId = input.keywordId;
			if (!keywordId) {
				if (!input.country || !input.keyword) {
					throw new Error("Pass keywordId, or both country and keyword.");
				}
				const overview = unwrap(
					await client.api.apps({ appId: input.appId }).tracking.get(),
				);
				const country = input.country.toLowerCase();
				const keyword = input.keyword.trim().toLowerCase();
				const match = overview.keywords.find(
					(k) => k.country === country && k.keyword === keyword,
				);
				if (!match) {
					throw new Error(`Keyword "${keyword}" is not tracked in ${country}.`);
				}
				keywordId = match.id;
			}
			return client.api
				.apps({ appId: input.appId })
				.tracking.keywords({ keywordId })
				.delete()
				.then(unwrap);
		},
		inputSchema: {
			appId: appIdSchema,
			country: countrySchema.optional(),
			keyword: z.string().min(1).optional(),
			keywordId: z.string().optional().describe("Tracked keyword UUID"),
		},
		name: "tracking_remove_keyword",
	}),
	defineTool({
		description:
			"Start a rank check for every tracked keyword of the app. Runs in the " +
			"background (throttled per store: about 3.5 s per App Store lookup, " +
			"1.5 s per Google Play lookup), so this returns the run at once; " +
			"poll tracking_check_status. If a check is already running it is " +
			"returned with alreadyRunning: true.",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				.tracking.check.post()
				.then(unwrap),
		inputSchema: { appId: appIdSchema },
		name: "tracking_run_check",
	}),
	defineTool({
		description:
			"Status of a rank check: running / completed / failed / interrupted, " +
			"progress (0-1), measured, ranked and failed lookups (with the store " +
			"error per keyword). Omit runId for the latest run.",
		handler: (client, input) => {
			const tracking = client.api.apps({ appId: input.appId }).tracking;
			return (
				input.runId
					? tracking.check({ runId: input.runId }).get()
					: tracking.check.get()
			).then(unwrap);
		},
		inputSchema: {
			appId: appIdSchema,
			runId: z
				.string()
				.uuid()
				.optional()
				.describe("Run UUID from tracking_run_check"),
		},
		name: "tracking_check_status",
	}),
	defineTool({
		description:
			"Update the app's tracking automation: rankTrackingEnabled (checks at " +
			"00:00 and 12:00), autoResearchEnabled + autoResearchFrequency " +
			"(daily/weekly/monthly), emailRankDigest, notifyEmail.",
		handler: (client, input) => {
			const { appId, ...patch } = input;
			return client.api
				.apps({ appId })
				.tracking.config.patch(patch)
				.then(unwrap);
		},
		inputSchema: {
			appId: appIdSchema,
			autoResearchEnabled: z.boolean().optional(),
			autoResearchFrequency: z.enum(["daily", "weekly", "monthly"]).optional(),
			emailRankDigest: z.boolean().optional(),
			notifyEmail: z.string().email().nullable().optional(),
			rankTrackingEnabled: z.boolean().optional(),
		},
		name: "tracking_update_config",
	}),
	// Research runs
	defineTool({
		description: "List saved research runs (reports) for an app, newest first.",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				["research-runs"].get()
				.then(unwrap),
		inputSchema: { appId: appIdSchema },
		name: "research_runs_list",
	}),
	defineTool({
		description:
			"Run market research on the app in one country and save it to its " +
			"history: reviews, store metadata, keyword positions (pass keywords) " +
			"and AI analysis when an OpenRouter key is set. Waits for the run - " +
			"deep runs can take a few minutes.",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				["research-runs"].run.post({
					country: input.country,
					...(input.deep !== undefined ? { deep: input.deep } : {}),
					...(input.keywords ? { keywords: input.keywords } : {}),
				})
				.then(unwrap),
		inputSchema: {
			appId: appIdSchema,
			country: countrySchema,
			deep: z
				.boolean()
				.optional()
				.describe("Full review scrape + map-reduce AI"),
			keywords: z.array(z.string().min(1)).max(15).optional(),
		},
		name: "research_run_start",
	}),
	defineTool({
		description:
			"Google Play store listing performance of an Android app per month " +
			"(newest first), from the Play Console bulk reports: acquisitions, " +
			"visitors and conversion rate by traffic source (Google Play " +
			"search, Ads and referrals, Other...), top search terms with Play " +
			"placeholders (Other / No search terms specified) apart, UTM " +
			"campaigns, countries and the installs overview when Play wrote " +
			"them. Android TV packages report everything as Other. When " +
			"status is not ok, message says what to fix (bucket not set, " +
			"service account without bulk-report permission). iOS apps " +
			"return supported: false.",
		handler: (client, input) =>
			client.api
				.apps({ appId: input.appId })
				["store-performance"].get({
					query: {
						...(input.months !== undefined ? { months: input.months } : {}),
						...(input.refresh ? { refresh: "true" } : {}),
					},
				})
				.then(unwrap),
		inputSchema: {
			appId: appIdSchema,
			months: z
				.number()
				.int()
				.min(1)
				.max(12)
				.optional()
				.describe(
					"How many calendar months back, current one included (default 3)",
				),
			refresh: z
				.boolean()
				.optional()
				.describe("Skip the 6 hour cache and read the bucket again"),
		},
		name: "store_performance_get",
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

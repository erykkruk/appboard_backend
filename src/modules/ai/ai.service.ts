import { and, eq } from "drizzle-orm";
import config from "@/config";
import { APP_STORE_CATEGORIES, GOOGLE_PLAY_CATEGORIES } from "@/config/const";
import { isCloud } from "@/config/deployment";
import {
	buildListingSystemPrompt,
	buildTranslationFieldRules,
	fieldLimit,
	getSettingKey,
	LISTING_FIELDS,
	PLAIN_TEXT,
	type PromptMode,
	type StorePlatform,
} from "@/modules/ai/ai.prompts";
import { AiErrors } from "@/modules/ai/ai-errors";
import {
	getDefaultPurchasePrompt,
	getPurchaseSettingKey,
	type PurchasePromptField,
	type PurchasePromptMode,
} from "@/modules/ai/monetization.prompts";
import { AppGroupsService } from "@/modules/app-groups/app-groups.service";
import { AsoProfileService } from "@/modules/aso-profile/aso-profile.service";
import { GroupAsoProfileService } from "@/modules/group-aso-profile/group-aso-profile.service";
import { SettingsService } from "@/modules/settings/settings.service";
import { db } from "@/utils/db";
import { appAiPrompts, apps, listings } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("ai-service");

const OPENROUTER_URL =
	config.OPENROUTER_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL =
	config.OPENROUTER_MODEL ?? "google/gemini-3-flash-preview";

/** Pull the human-readable message out of an OpenRouter JSON error body. */
export function extractOpenRouterMessage(body: string): string {
	try {
		const parsed = JSON.parse(body) as { error?: { message?: string } };
		return parsed.error?.message ?? body.slice(0, 200);
	} catch {
		return body.slice(0, 200);
	}
}

function truncateToLimit(value: string, limit: number, field: string): string {
	if (value.length <= limit) return value;

	// Keywords: truncate at last comma boundary
	if (field === "keywords") {
		const cut = value.substring(0, limit);
		const lastComma = cut.lastIndexOf(",");
		return lastComma > 0 ? cut.substring(0, lastComma) : cut;
	}

	// Short fields (title, subtitle, shortDescription): truncate at last word boundary
	const cut = value.substring(0, limit);
	const lastSpace = cut.lastIndexOf(" ");
	if (lastSpace > limit * 0.5) {
		return cut.substring(0, lastSpace);
	}
	return cut;
}

/**
 * Drops emoji the stores reject and normalizes typographic characters the
 * prompts forbid, without touching the line structure: a description's blank
 * lines and bullet lines are part of what the prompt asked for.
 */
function stripEmoji(text: string): string {
	return text
		.replace(/\p{Emoji_Presentation}/gu, "")
		.replace(/\p{Extended_Pictographic}/gu, "")
		.replace(/\uFE0F/g, "")
		.replace(/\u200D/g, "")
		.replace(/[\u2013\u2014]/g, "-")
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201C\u201D]/g, '"')
		.replace(/\u2026/g, "...")
		.split("\n")
		.map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** The JSON object out of an answer that may wrap it in a fence or prose. */
function extractJsonObject(raw: string): string {
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const body = (fenced ? fenced[1] : raw).trim();
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

function storePlatform(platform: string): StorePlatform {
	return platform === "ios" ? "ios" : "android";
}

type ListingField =
	| "title"
	| "subtitle"
	| "shortDescription"
	| "description"
	| "fullDescription"
	| "keywords"
	| "promotionalText"
	| "whatsNew";

export type { ListingField };

const FIELD_LABELS: Record<ListingField, string> = {
	description: "App Description",
	fullDescription: "Full Description (Google Play)",
	keywords: "Keywords",
	promotionalText: "Promotional Text",
	shortDescription: "Short Description",
	subtitle: "Subtitle",
	title: "App Title/Name",
	whatsNew: "What's New (Release Notes)",
};

interface OpenRouterResponse {
	choices: { message: { content: string } }[];
	model: string;
}

function buildAsoContext(profile: {
	awards?: string[] | null;
	brandVoiceExample?: string | null;
	category?: string | null;
	competitiveAdvantage?: string | null;
	competitors?: string[] | null;
	differentiator?: string | null;
	downloadCount?: string | null;
	excludeKeywords?: string[] | null;
	freeFeatures?: string[] | null;
	keyFeatures?: string[] | null;
	longTailKeywords?: string[] | null;
	mainBenefit?: string | null;
	mustIncludeKeywords?: string[] | null;
	oneLiner?: string | null;
	painPoints?: string[] | null;
	positioning?: string | null;
	premiumFeatures?: string[] | null;
	pressQuotes?: string[] | null;
	price?: string | null;
	pricingModel?: string | null;
	problem?: string | null;
	targetAudience?: string | null;
	testimonials?: string[] | null;
	tone?: string | null;
	userLanguage?: string | null;
	wordsToAvoid?: string[] | null;
	wordsToInclude?: string[] | null;
}): string {
	const lines: string[] = [];

	if (profile.oneLiner) lines.push(`One-liner: ${profile.oneLiner}`);
	if (profile.category) lines.push(`Category: ${profile.category}`);
	if (profile.problem) lines.push(`Problem solved: ${profile.problem}`);
	if (profile.mainBenefit) lines.push(`Main benefit: ${profile.mainBenefit}`);
	if (profile.differentiator)
		lines.push(`Differentiator: ${profile.differentiator}`);
	if (profile.keyFeatures?.length)
		lines.push(`Key features: ${profile.keyFeatures.join(", ")}`);
	if (profile.targetAudience)
		lines.push(`Target audience: ${profile.targetAudience}`);
	if (profile.painPoints?.length)
		lines.push(`Pain points: ${profile.painPoints.join(", ")}`);
	if (profile.userLanguage)
		lines.push(`User language style: ${profile.userLanguage}`);
	if (profile.tone) lines.push(`Tone: ${profile.tone}`);
	if (profile.brandVoiceExample)
		lines.push(`Brand voice example: "${profile.brandVoiceExample}"`);
	if (profile.positioning) lines.push(`Positioning: ${profile.positioning}`);
	if (profile.competitiveAdvantage)
		lines.push(`Competitive advantage: ${profile.competitiveAdvantage}`);
	if (profile.competitors?.length)
		lines.push(`Competitors: ${profile.competitors.join(", ")}`);
	if (profile.downloadCount) lines.push(`Downloads: ${profile.downloadCount}`);
	if (profile.awards?.length)
		lines.push(`Awards: ${profile.awards.join(", ")}`);
	if (profile.pressQuotes?.length)
		lines.push(`Press quotes: ${profile.pressQuotes.join(" | ")}`);
	if (profile.testimonials?.length)
		lines.push(`Testimonials: ${profile.testimonials.join(" | ")}`);
	if (profile.pricingModel) lines.push(`Pricing: ${profile.pricingModel}`);
	if (profile.price) lines.push(`Price: ${profile.price}`);
	if (profile.freeFeatures?.length)
		lines.push(`Free features: ${profile.freeFeatures.join(", ")}`);
	if (profile.premiumFeatures?.length)
		lines.push(`Premium features: ${profile.premiumFeatures.join(", ")}`);
	if (profile.mustIncludeKeywords?.length)
		lines.push(
			`Must-include keywords: ${profile.mustIncludeKeywords.join(", ")}`,
		);
	if (profile.longTailKeywords?.length)
		lines.push(`Long-tail keywords: ${profile.longTailKeywords.join(", ")}`);
	if (profile.excludeKeywords?.length)
		lines.push(`Exclude keywords: ${profile.excludeKeywords.join(", ")}`);
	if (profile.wordsToInclude?.length)
		lines.push(`Words to include: ${profile.wordsToInclude.join(", ")}`);
	if (profile.wordsToAvoid?.length)
		lines.push(`Words to avoid: ${profile.wordsToAvoid.join(", ")}`);

	return lines.join("\n");
}

async function resolvePrompt(
	field: ListingField,
	mode: PromptMode,
	platform: string,
	workspaceId: string,
	appId?: string,
	/** The field the overrides are stored under (fullDescription on Play). */
	settingsField: ListingField = field,
): Promise<string> {
	// 1. Per-app custom prompt
	if (appId) {
		const [row] = await db
			.select()
			.from(appAiPrompts)
			.where(
				and(
					eq(appAiPrompts.appId, appId),
					eq(appAiPrompts.field, settingsField),
					eq(appAiPrompts.mode, mode),
				),
			)
			.limit(1);
		if (row?.prompt) return row.prompt;
	}

	// 2. Global custom prompt from settings
	const settingKey = getSettingKey(settingsField, mode);
	const globalPrompt = await SettingsService.getRaw(workspaceId, settingKey);
	if (globalPrompt) return globalPrompt;

	// 3. Built-in default: the same text Settings shows as "default", for the
	// store the app is on.
	return buildListingSystemPrompt(field, mode, storePlatform(platform));
}

interface ListingContext {
	title?: string | null;
	subtitle?: string | null;
	keywords?: string | null;
	description?: string | null;
}

const CONTEXT_DESCRIPTION_CHARS = 1500;

/** What is already in the store for this language: the words to avoid repeating. */
function listingContextBlock(
	context: ListingContext | null | undefined,
	platform: string,
): string {
	if (!context || (!context.title && !context.subtitle && !context.keywords)) {
		return "Current listing: unknown. Avoid repeating only the brand name.\n";
	}
	const lines = [
		`Current title: ${context.title ?? "(empty)"}`,
		`Current ${platform === "ios" ? "subtitle" : "short description"}: ${context.subtitle ?? "(empty)"}`,
	];
	if (platform === "ios") {
		lines.push(`Current keyword field: ${context.keywords ?? "(empty)"}`);
		lines.push(
			"App Store: a word already in the title or subtitle must not appear in the field you write.",
		);
	} else {
		lines.push(
			"Google Play: reuse the core search term from the title, never the whole title.",
		);
	}
	if (context.description) {
		lines.push(
			`Current description (opening): ${context.description.slice(0, CONTEXT_DESCRIPTION_CHARS)}`,
		);
	}
	return `${lines.join("\n")}\n`;
}

function buildUserPrompt(
	field: ListingField,
	appName: string,
	platform: string,
	language: string,
	asoContext: string,
	currentValue?: string,
	asoProfile?: {
		painPoints?: string[] | null;
		targetAudience?: string | null;
		userLanguage?: string | null;
	} | null,
	options: { brief?: string; listing?: ListingContext | null } = {},
): string {
	const charLimit = fieldLimit(field, storePlatform(platform));
	const fieldLabel = FIELD_LABELS[field];
	const isRephrase = !!currentValue;

	let prompt = `App name: ${appName}
Platform: ${platform === "ios" ? "iOS (App Store)" : "Android (Google Play)"}
Language: ${language} (write in this language; if the current text is in another language, rewrite it into this one)
Field: ${fieldLabel} (limit ${charLimit} characters)

${listingContextBlock(options.listing, platform)}
ASO Profile:
${asoContext || "No brief was provided. Write only what the app name and the current text support; leave out features, numbers and proof you do not have, and keep the copy short rather than fill it."}
`;

	if (asoProfile?.targetAudience || asoProfile?.painPoints?.length) {
		prompt += "\nPersona:\n";
		if (asoProfile.targetAudience) {
			prompt += `- Address the reader as if they are: ${asoProfile.targetAudience}\n`;
			prompt +=
				"- Use their vocabulary and reference their specific situation\n";
		}
		if (asoProfile.painPoints?.length) {
			prompt += `- Reference these problems they face: ${asoProfile.painPoints.join(", ")}\n`;
		}
		if (asoProfile.userLanguage) {
			prompt += `- Match this communication style: ${asoProfile.userLanguage}\n`;
		}
	}

	if (options.brief) {
		prompt += `
Changes that shipped (developer notes, may be terse):
"""
${options.brief}
"""
TASK: Write the ${fieldLabel} from these changes.`;
	} else if (isRephrase) {
		prompt += `
Current text to rephrase:
"""
${currentValue}
"""
TASK: Rephrase the text above so it follows every rule, keeping the facts and the meaning; store rules win over keeping the wording.`;
	} else {
		prompt += `
TASK: Write the ${fieldLabel} for this app.`;
	}

	prompt +=
		"\n\nReturn ONLY the finished text: no explanations, no quotes, no labels. No emoji, no typographic dashes or curly quotes.";

	return prompt;
}

/**
 * User prompt for a description built around target keywords. Unlike
 * buildUserPrompt it carries the current store text, so the model has real
 * facts to keep instead of guessing them from the app name.
 */
function buildKeywordDescriptionPrompt(
	appName: string,
	platform: string,
	brief: string,
	keywords: string[],
	charLimit: number,
): string {
	const fieldLabel = FIELD_LABELS.description;
	const isIos = platform === "ios";
	const list = keywords.map((keyword) => `- ${keyword}`).join("\n");
	const keywordBlock = keywords.length
		? `${
				isIos
					? "Phrases readers use when they look for an app like this (the App Store does not index the description, so use them only where they make the copy clearer):"
					: "Target keywords, most important first. Work each one in naturally (the first ones early in the text) and never as a bare list:"
			}
${list}
Store rules override this list: skip any entry that is the name of another app, a company or a trademark (other than this app's own brand), an "alternative to" phrase, a promotional or ranking word (best, #1, top, free, sale, download now) or anything the app does not actually do. Do not mention that you skipped it.

`
		: "";
	const task = keywords.length
		? isIos
			? `Write a new ${fieldLabel} that speaks in these phrases where they help the reader.`
			: `Write a new ${fieldLabel} for this app built around the target keywords.`
		: `Write a new ${fieldLabel} for this app.`;

	return `App name: ${appName}
Platform: ${isIos ? "iOS (App Store)" : "Android (Google Play)"}
Field: ${fieldLabel} (limit ${charLimit} characters)

What the app does (current store text or a short brief):
"""
${brief}
"""

${keywordBlock}TASK: ${task} Keep every claim grounded in the text above. Write in the same language as that text. Open with the strongest benefit.

Return ONLY the finished text: no explanations, no quotes, no labels. No emoji, no typographic dashes or curly quotes.`;
}

function resolveFieldForPlatform(
	field: ListingField,
	platform: string,
): ListingField {
	const isIos = platform === "ios";

	// Google Play uses "fullDescription", internally we map to "description"
	// which has platform-aware prompts (iOS = conversion only, Android = SEO + conversion)
	if (field === "fullDescription") return "description";

	if (!isIos && field === "subtitle") return "shortDescription";

	if (!isIos && field === "keywords") {
		buildError("badRequest", {
			info: "Keywords field does not exist on Android. Use title, short description, and long description for keyword strategy.",
		});
	}
	if (!isIos && field === "promotionalText") {
		buildError("badRequest", {
			info: "Promotional Text is an iOS-only field.",
		});
	}

	if (isIos && field === "shortDescription") {
		buildError("badRequest", {
			info: "Short Description is an Android-only field. Use subtitle for iOS.",
		});
	}

	return field;
}

type PurchaseField =
	| "purchaseName"
	| "purchaseDescription"
	| "reviewNotes"
	| "productId"
	| "groupName"
	| "groupDescription";

const PURCHASE_FIELD_CHAR_LIMITS: Partial<Record<PurchaseField, number>> = {
	groupDescription: 45,
	groupName: 30,
	purchaseDescription: 45,
	purchaseName: 30,
	reviewNotes: 4000,
};

async function resolvePurchasePrompt(
	field: PurchasePromptField,
	mode: PurchasePromptMode,
	workspaceId: string,
	appId?: string,
): Promise<string> {
	// 1. Per-app custom prompt
	if (appId) {
		const [row] = await db
			.select()
			.from(appAiPrompts)
			.where(
				and(
					eq(appAiPrompts.appId, appId),
					eq(appAiPrompts.field, field),
					eq(appAiPrompts.mode, mode),
				),
			)
			.limit(1);
		if (row?.prompt) return row.prompt;
	}

	// 2. Global custom prompt from settings
	const settingKey = getPurchaseSettingKey(field, mode);
	const globalPrompt = await SettingsService.getRaw(workspaceId, settingKey);
	if (globalPrompt) return globalPrompt;

	// 3. Built-in default
	return getDefaultPurchasePrompt(field, mode);
}

function buildPurchaseUserPrompt(
	field: PurchaseField,
	context: {
		appName: string;
		productType?: string;
		productName?: string;
		groupName?: string;
		duration?: string;
		bundleId?: string;
	},
	currentValue?: string,
	language?: string,
): string {
	const charLimit = PURCHASE_FIELD_CHAR_LIMITS[field];
	const isRephrase = !!currentValue;

	let prompt = `App name: ${context.appName}\n`;
	if (context.productType) prompt += `Product type: ${context.productType}\n`;
	if (context.productName) prompt += `Product name: ${context.productName}\n`;
	if (context.groupName) prompt += `Subscription group: ${context.groupName}\n`;
	if (context.duration) prompt += `Duration: ${context.duration}\n`;
	if (context.bundleId) prompt += `Bundle ID: ${context.bundleId}\n`;
	if (language) prompt += `Language: ${language}\n`;

	if (isRephrase) {
		prompt += `\nCurrent text to improve:\n"""\n${currentValue}\n"""\n\nTASK: Rephrase the text above to be more compelling and effective. Keep the same core meaning.`;
	} else {
		prompt += `\nTASK: Generate the content for this field.`;
	}

	if (charLimit) {
		prompt += ` Stay within ${charLimit} characters.`;
	}

	if (language) {
		prompt += ` Write in ${language} language.`;
	}

	prompt +=
		"\n\nIMPORTANT: Return ONLY the generated text, no explanations, no quotes, no labels. Just the raw content.";

	return prompt;
}

export type AiPurpose = "generate" | "rephrase" | "research";

const DEFAULT_TEMPERATURE = 0.7;
const MODELS_URL = "https://openrouter.ai/api/v1/models";
const MODELS_TTL_MS = 6 * 60 * 60 * 1000;

export interface AiModel {
	id: string;
	name: string;
	provider: string;
	contextLength: number | null;
	/** USD per token as OpenRouter reports it. */
	pricing: { prompt: number; completion: number };
}

interface OpenRouterCatalogModel {
	id: string;
	name?: string;
	context_length?: number;
	pricing?: { prompt?: string; completion?: string };
	architecture?: {
		modality?: string;
		input_modalities?: string[];
		output_modalities?: string[];
	};
}

let modelsCache: { at: number; models: AiModel[] } | null = null;

/** Only models that read and write text can run a prompt. */
function isTextModel(model: OpenRouterCatalogModel): boolean {
	const arch = model.architecture;
	if (!arch) return true;
	const inputs =
		arch.input_modalities ?? arch.modality?.split("->")[0]?.split("+") ?? [];
	const outputs =
		arch.output_modalities ?? arch.modality?.split("->")[1]?.split("+") ?? [];
	const reads = inputs.length === 0 || inputs.includes("text");
	const writes = outputs.length === 0 || outputs.includes("text");
	return reads && writes;
}

const PURPOSE_SETTING_KEYS: Record<AiPurpose, string> = {
	generate: "AI_MODEL_GENERATE",
	rephrase: "AI_MODEL_REPHRASE",
	research: "AI_MODEL_RESEARCH",
};

export class AIService {
	/**
	 * Returns the effective ASO profile for an app.
	 * If the app belongs to a group with shared profile enabled,
	 * returns the group profile; otherwise returns the app's own profile.
	 */
	static async resolveAsoProfile(appId: string) {
		const groupInfo = await AppGroupsService.getGroupForApp(appId);
		if (groupInfo?.useSharedProfile) {
			const groupProfile = await GroupAsoProfileService.get(groupInfo.groupId);
			if (groupProfile) return groupProfile;
		}
		return AsoProfileService.get(appId);
	}

	private static async resolveModel(
		workspaceId: string,
		purpose: AiPurpose,
	): Promise<string> {
		const settingKey = PURPOSE_SETTING_KEYS[purpose];
		const model = await SettingsService.getRaw(workspaceId, settingKey);
		return model || DEFAULT_MODEL;
	}

	/**
	 * Workspace key first, then the instance-wide env key. A self-hosted
	 * install that sets OPENROUTER_API_KEY once should get AI everywhere
	 * without every workspace pasting the same key into Settings.
	 */
	/**
	 * The instance key is a self-hosting convenience: one operator, one bill.
	 * On the cloud deployment every workspace is a different customer, so the
	 * env key must never quietly pay for all of them - only their own key counts.
	 */
	private static instanceKey(): string | null {
		if (isCloud()) return null;
		return config.OPENROUTER_API_KEY || null;
	}

	static async resolveApiKey(workspaceId: string): Promise<string | null> {
		const own = await SettingsService.getRaw(workspaceId, "OPENROUTER_API_KEY");
		if (own) return own;
		return AIService.instanceKey();
	}

	/** What the panel needs to say "AI is on" or "add a key and you get...". */
	static async status(workspaceId: string): Promise<{
		configured: boolean;
		source: "workspace" | "instance" | null;
		lastError: string | null;
	}> {
		const lastError = AiErrors.get(workspaceId);
		const own = await SettingsService.getRaw(workspaceId, "OPENROUTER_API_KEY");
		if (own) return { configured: true, lastError, source: "workspace" };
		if (AIService.instanceKey()) {
			return { configured: true, lastError, source: "instance" };
		}
		return { configured: false, lastError: null, source: null };
	}

	/**
	 * One completion with the workspace's key and the model it chose for
	 * `purpose` in Settings. The public entry point for features that live
	 * outside this module (the audit review, for one) so they never build
	 * their own OpenRouter call.
	 */
	static async complete(
		workspaceId: string,
		systemPrompt: string,
		userPrompt: string,
		options: { purpose?: AiPurpose; temperature?: number } = {},
	): Promise<{ content: string; model: string }> {
		return AIService.callOpenRouter(
			workspaceId,
			systemPrompt,
			userPrompt,
			options.purpose ?? "generate",
			options.temperature,
		);
	}

	/**
	 * The OpenRouter catalog, text models only, cached for a while: the
	 * Settings picker should offer whatever exists today instead of a list we
	 * typed once and forgot to update.
	 */
	static async listModels(): Promise<AiModel[]> {
		if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) {
			return modelsCache.models;
		}
		const response = await fetch(MODELS_URL);
		if (!response.ok) {
			buildError("storeApiError", {
				info: `OpenRouter model catalog unavailable: ${response.status}`,
			});
		}
		const data = (await response.json()) as { data?: OpenRouterCatalogModel[] };
		const models = (data.data ?? [])
			.filter((m) => isTextModel(m) && !m.id.endsWith(":batch"))
			.map((m) => ({
				contextLength: m.context_length ?? null,
				id: m.id,
				name: m.name ?? m.id,
				pricing: {
					completion: Number(m.pricing?.completion ?? 0),
					prompt: Number(m.pricing?.prompt ?? 0),
				},
				provider: m.id.split("/")[0] ?? "",
			}))
			.sort((a, b) =>
				a.provider === b.provider
					? a.name.localeCompare(b.name)
					: a.provider.localeCompare(b.provider),
			);
		modelsCache = { at: Date.now(), models };
		return models;
	}

	private static async callOpenRouter(
		workspaceId: string,
		systemPrompt: string,
		userPrompt: string,
		purpose: AiPurpose = "generate",
		temperature: number = DEFAULT_TEMPERATURE,
	): Promise<{ content: string; model: string }> {
		const apiKey = await AIService.resolveApiKey(workspaceId);
		if (!apiKey) {
			buildError("badRequest", {
				info: "OpenRouter API key not configured. Go to Settings to add it.",
			});
		}

		const selectedModel = await AIService.resolveModel(workspaceId, purpose);

		const response = await fetch(OPENROUTER_URL, {
			body: JSON.stringify({
				messages: [
					{ content: systemPrompt, role: "system" },
					{ content: userPrompt, role: "user" },
				],
				model: selectedModel,
				temperature,
			}),
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => "Unknown error");
			AiErrors.set(
				workspaceId,
				response.status === 401
					? "OpenRouter rejected the key"
					: `OpenRouter error ${response.status}`,
			);
			log.error({ errorBody, status: response.status }, "OpenRouter API error");

			if (response.status === 402) {
				buildError("badRequest", {
					info: "OpenRouter API: out of credits. Top up your balance at openrouter.ai/settings/credits.",
				});
			}

			if (response.status === 401) {
				buildError("badRequest", {
					info: "OpenRouter API: invalid API key. Check your key in Settings.",
				});
			}

			if (response.status === 429) {
				buildError("badRequest", {
					info: "OpenRouter API: rate limit exceeded. Please wait a moment and try again.",
				});
			}

			if (response.status === 400) {
				buildError("badRequest", {
					info: `OpenRouter API: ${extractOpenRouterMessage(errorBody)}. Check the model in Settings.`,
				});
			}

			buildError("storeApiError", {
				info: `OpenRouter API error: ${response.status}`,
			});
		}

		const data = (await response.json()) as OpenRouterResponse;
		const content = data.choices?.[0]?.message?.content;

		if (!content) {
			log.error({ data }, "Empty response from OpenRouter");
			buildError("somethingWentWrong", {
				info: "AI returned empty response",
			});
		}

		AiErrors.set(workspaceId, null);
		return { content: content.trim(), model: data.model ?? DEFAULT_MODEL };
	}

	static async generatePurchaseField(
		workspaceId: string,
		appId: string,
		field:
			| "purchaseName"
			| "purchaseDescription"
			| "reviewNotes"
			| "productId"
			| "groupName"
			| "groupDescription",
		context: {
			appName: string;
			productType?: string;
			productName?: string;
			groupName?: string;
			duration?: string;
			bundleId?: string;
		},
		currentValue?: string,
		language?: string,
	): Promise<{ model: string; result: string }> {
		const asoProfile = await AIService.resolveAsoProfile(appId);
		const asoContext = asoProfile ? buildAsoContext(asoProfile) : "";

		const mode: PurchasePromptMode = currentValue ? "rephrase" : "generate";
		let systemPrompt = await resolvePurchasePrompt(
			field,
			mode,
			workspaceId,
			appId,
		);
		if (asoContext) {
			systemPrompt += `\n\nApp context:\n${asoContext}`;
		}
		const userPrompt = buildPurchaseUserPrompt(
			field,
			context,
			currentValue,
			language,
		);

		log.info(
			{ appId, currentValue: !!currentValue, field, language },
			"Generating purchase field",
		);

		const { content, model } = await AIService.callOpenRouter(
			workspaceId,
			systemPrompt,
			userPrompt,
			mode as AiPurpose,
		);

		const cleaned = stripEmoji(content);
		const charLimit = PURCHASE_FIELD_CHAR_LIMITS[field];
		const result =
			charLimit && cleaned.length > charLimit
				? truncateToLimit(cleaned, charLimit, field)
				: cleaned;

		return { model, result };
	}

	/** The draft (or the store copy) for one language: title, subtitle, keywords. */
	private static async listingContext(
		appId: string,
		language: string,
	): Promise<ListingContext | null> {
		const rows = await db
			.select()
			.from(listings)
			.where(and(eq(listings.appId, appId), eq(listings.language, language)));
		const row =
			rows.find((r) => r.source === "draft") ??
			rows.find((r) => r.source === "remote");
		if (!row) return null;
		return {
			description: row.fullDesc,
			keywords: row.keywords,
			subtitle: row.shortDesc,
			title: row.title,
		};
	}

	static async generateListingField(
		workspaceId: string,
		field: ListingField,
		appId: string,
		appName: string,
		platform: string,
		language: string,
		currentValue?: string,
		options: { brief?: string } = {},
	): Promise<{ model: string; result: string }> {
		const resolvedField = resolveFieldForPlatform(field, platform);
		// Overrides live under the field Settings shows: a Play description is
		// edited as "fullDescription" there, while the built-in default is the
		// resolved field on the app's store.
		const settingsField: ListingField =
			field === "fullDescription" ||
			(platform !== "ios" && field === "description")
				? "fullDescription"
				: resolvedField;

		const asoProfile = appId ? await AIService.resolveAsoProfile(appId) : null;
		const asoContext = asoProfile ? buildAsoContext(asoProfile) : "";
		const listing = appId
			? await AIService.listingContext(appId, language)
			: null;

		const mode: PromptMode = currentValue ? "rephrase" : "generate";
		const systemPrompt = await resolvePrompt(
			resolvedField,
			mode,
			platform,
			workspaceId,
			appId || undefined,
			settingsField,
		);
		const userPrompt = buildUserPrompt(
			resolvedField,
			appName,
			platform,
			language,
			asoContext,
			currentValue,
			asoProfile,
			{ brief: options.brief, listing },
		);

		log.info(
			{ appId, currentValue: !!currentValue, field: resolvedField, language },
			"Generating listing field",
		);

		const purpose: AiPurpose = currentValue ? "rephrase" : "generate";
		const { content, model } = await AIService.callOpenRouter(
			workspaceId,
			systemPrompt,
			userPrompt,
			purpose,
		);

		const cleaned = stripEmoji(content);
		const charLimit = fieldLimit(resolvedField, storePlatform(platform));
		const trimmedContent =
			cleaned.length > charLimit
				? truncateToLimit(cleaned, charLimit, resolvedField)
				: cleaned;

		return { model, result: trimmedContent };
	}

	static async translate(
		workspaceId: string,
		text: string,
		targetLanguages: string[],
	) {
		const systemPrompt = `You localize app store copy. A localization is a rewrite for another market, not a word-for-word translation:
- It reads as if written in the target language first: natural phrasing, the register that market expects.
- It keeps the meaning, the facts, the brand name and the marketing intent of the original.
- Idioms, examples and cultural references are adapted to what the target market knows; anything that does not exist there is replaced, not translated literally.
- Store policies still apply: no emoji, no decorative symbols, no typographic dashes or curly quotes, no promotional words the stores flag.`;
		const userPrompt = `Translate the following app store text to these languages: ${targetLanguages.join(", ")}

Text:
"""
${text}
"""

Return a JSON object where keys are language codes and values are translations. Return ONLY the JSON, no explanations.`;

		const { content, model } = await AIService.callOpenRouter(
			workspaceId,
			systemPrompt,
			userPrompt,
			"generate",
		);

		try {
			const translations = JSON.parse(extractJsonObject(content)) as Record<
				string,
				string
			>;
			return { model, translations };
		} catch {
			log.error({ content }, "Failed to parse translation response");
			buildError("somethingWentWrong", {
				info: "AI returned invalid translation format",
			});
		}
	}

	/**
	 * A description rewritten around target keywords. The brief is the current
	 * store text (or a short pitch) so the model keeps the facts and only
	 * reworks the copy; from the app name alone it would invent features.
	 */
	static async generateDescription(
		workspaceId: string,
		appName: string,
		prompt: string,
		platform?: string,
		keywords?: string[],
	) {
		// The panel sends the app platform, older callers a store type.
		const resolvedPlatform =
			!platform || platform === "ios" || platform === "app_store"
				? "ios"
				: "android";
		const charLimit = fieldLimit(
			"description",
			storePlatform(resolvedPlatform),
		);
		const targetKeywords = (keywords ?? [])
			.map((keyword) => keyword.trim())
			.filter((keyword) => keyword.length > 0);

		const systemPrompt = await resolvePrompt(
			"description",
			"generate",
			resolvedPlatform,
			workspaceId,
		);
		const userPrompt = buildKeywordDescriptionPrompt(
			appName,
			resolvedPlatform,
			prompt,
			targetKeywords,
			charLimit,
		);

		log.info(
			{ keywords: targetKeywords.length, platform: resolvedPlatform },
			"Generating keyword-targeted description",
		);

		const { content, model } = await AIService.callOpenRouter(
			workspaceId,
			systemPrompt,
			userPrompt,
			"generate",
		);

		const cleaned = stripEmoji(content);
		const description =
			cleaned.length > charLimit
				? truncateToLimit(cleaned, charLimit, "description")
				: cleaned;

		// `result` is what every other AI endpoint returns; `description` stays
		// for callers written against the old shape.
		return { description, model, result: description };
	}

	static async suggestKeywords(
		workspaceId: string,
		appName: string,
		description?: string,
		category?: string,
		currentKeywords?: string[],
		options: { language?: string; platform?: string } = {},
	) {
		const systemPrompt = `You are an ASO keyword researcher. You propose the search terms a person would type into the App Store or Google Play to find this app - terms for tracking and for the listing's own words, not a wish list.

How to choose:
- Start from what the app actually does and the problem it solves; every term must be something this app can honestly rank for.
- Think in searches, not features: store searches are one to three word noun phrases ("habit tracker", "sleep sounds", "invoice maker"), never sentences or questions; phrase the need the way it is typed, not spoken.
- Mix short, high-demand terms with specific two- or three-word phrases that face less competition.
- Singular forms, lower case, no punctuation, no "app".
- Competitor names go only into the "competitors" cluster, for rank tracking; they are never used as listing text (store policy). No celebrity or public-figure names, no offensive terms, no trademarks other than the app's own brand in the other clusters.
- Do not repeat a term across clusters; no near-duplicates ("budget app", "budgeting app").`;

		const storeLabel =
			options.platform === "ios"
				? "App Store"
				: options.platform === "android"
					? "Google Play"
					: "App Store and Google Play";
		const userPrompt = `App: ${appName}
Store: ${storeLabel}
Market language: ${options.language ?? "the language of the description"}
${description ? `Description: ${description}` : ""}
${category ? `Category: ${category}` : ""}
${currentKeywords?.length ? `Current keywords (already used - do not repeat them, propose what is missing): ${currentKeywords.join(", ")}` : ""}

Propose keywords in the market language, grouped by what the searcher has in mind. Return ONLY a JSON object with this exact structure and nothing else:
{
  "feature": ["what the app does, as people search for it"],
  "problem": ["the need or problem, as people phrase it in a search"],
  "category": ["the category and niche terms"],
  "competitors": ["names of rival apps people search for - for rank tracking only, never listing text"],
  "longTail": ["specific two- or three-word phrases with a clear intent"]
}
Three to five terms per cluster, about fifteen to twenty in total, most relevant first.`;

		const { content, model } = await AIService.callOpenRouter(
			workspaceId,
			systemPrompt,
			userPrompt,
			"research",
		);

		try {
			const clusters = JSON.parse(extractJsonObject(content)) as Record<
				string,
				string[]
			>;
			// Rival names are for tracking; they must never reach a listing
			// field, so the flat list the panel turns into chips leaves them out.
			const {
				competitors = [],
				alternative = [],
				...listingClusters
			} = clusters;
			const keywords = Object.values(listingClusters)
				.flat()
				.filter((k): k is string => typeof k === "string" && k.trim() !== "");
			return {
				clusters: listingClusters,
				keywords,
				model,
				trackingOnly: [...competitors, ...alternative],
			};
		} catch {
			log.warn(
				{ content: content.slice(0, 200) },
				"Keyword suggestion was not JSON",
			);
			buildError("somethingWentWrong", {
				info: "AI returned keywords in an unexpected format. Try again.",
			});
		}
	}

	static async draftReply(
		workspaceId: string,
		reviewText: string,
		rating: number,
		authorName: string,
		tone?: string,
	) {
		const systemPrompt = `You write the developer's public replies to app store reviews. Every reply is read by the reviewer and by everyone deciding whether to install, and it is published under the developer's name.

Shape of a reply:
1. Acknowledge the specific experience in the review - the actual detail, not a template line.
2. Thank them briefly.
3. Address the point: for a problem, what you are doing about it or how to fix it now (a concrete step, a setting, a support path); for praise, one specific thing worth their attention next.
4. Invite: for a problem, a way to reach support; after a fix you may invite them once, without pressure, to try again and update their review if it now works. Never offer anything in exchange for a rating and never make the rating a condition - both stores forbid incentives.
- Support contact: use only a channel given in the task; otherwise write "reach us through the support link on the store page". Never invent an email address, phone number or URL.

Rules:
- Two to four sentences, at most 350 characters so it fits Google Play's limit and reads well on the App Store.
- Write in the language of the review.
- Use the reviewer's name only if it is a real name, never a handle like "user123".
- Never defensive, never sarcastic, never blaming the reviewer, even when the review is unfair or wrong; correct facts calmly.
- No personal data, no account details, no promises you cannot keep, no marketing.
- Plain text: no emoji, no typographic dashes or curly quotes.
- Return only the reply text.`;

		const isPositive = rating >= 4;
		const userPrompt = `Review by ${authorName} (${rating}/5 stars):
"${reviewText}"

${tone ? `Desired tone: ${tone}` : ""}

Write a ${isPositive ? "warm reply that thanks them for the specific thing they praised" : "calm, solution-oriented reply that addresses the specific problem they describe"}, in the language of the review, two to four sentences, under 350 characters. Return ONLY the reply text.`;

		const { content, model } = await AIService.callOpenRouter(
			workspaceId,
			systemPrompt,
			userPrompt,
			"generate",
		);
		return { model, reply: content };
	}

	static async generatePrivacyDeclaration(
		workspaceId: string,
		appName: string,
		description: string,
		platform?: string,
	): Promise<{ model: string; result: string }> {
		const isAndroid = platform === "android";

		const iosSystemPrompt = `You are an expert in Apple App Store privacy declarations (App Privacy "nutrition labels").

Given an app name and a description of what data it collects and processes, generate a structured privacy declaration.

Return ONLY valid JSON: an array of objects with this exact shape:
{ "category": string, "dataType": string, "purposes": string[], "linked": boolean, "tracking": boolean }

Valid categories: "contact_info", "health_fitness", "financial", "location", "sensitive_info", "contacts", "user_content", "browsing_history", "search_history", "identifiers", "purchases", "usage_data", "diagnostics", "other"

Example data types per category:
- contact_info: "Email Address", "Name", "Phone Number", "Physical Address"
- health_fitness: "Health", "Fitness"
- financial: "Payment Info", "Credit Info"
- location: "Precise Location", "Coarse Location"
- contacts: "Contacts"
- user_content: "Photos or Videos", "Audio Data", "Other User Content"
- identifiers: "User ID", "Device ID"
- purchases: "Purchase History"
- usage_data: "Product Interaction", "Advertising Data"
- diagnostics: "Crash Data", "Performance Data"

Valid purposes: "analytics", "app_functionality", "developers_advertising", "other_purposes", "product_personalization", "third_party_advertising"

Rules:
- "linked" = true if the data is linked to the user's identity (e.g. via login)
- "tracking" = true if the data is used for tracking across apps/websites (ATT relevant)
- Be realistic and thorough - include all data types implied by the description
- Include diagnostics (crash data) by default unless the description explicitly says no analytics
- Return a JSON array, no markdown, no explanations`;

		const gpSystemPrompt = `You are an expert in Google Play Data Safety declarations.

Given an app name and a description of what data it collects and processes, generate a structured data safety declaration.

Return ONLY valid JSON: an array of objects with this exact shape:
{ "category": string, "dataType": string, "purposes": string[], "collected": boolean, "shared": boolean, "ephemeral": boolean, "required": boolean, "linked": false, "tracking": false }

Valid categories: "location", "personal_info", "financial_info", "health_fitness", "messages", "photos_videos", "audio", "files_docs", "calendar", "contacts", "app_activity", "web_browsing", "app_info_performance", "device_ids"

Example data types per category:
- location: "Approximate location", "Precise location"
- personal_info: "Name", "Email address", "User IDs", "Address", "Phone number"
- financial_info: "User payment info", "Purchase history", "Credit score"
- health_fitness: "Health info", "Fitness info"
- messages: "Emails", "SMS or MMS", "Other in-app messages"
- photos_videos: "Photos", "Videos"
- audio: "Voice or sound recordings", "Music files"
- files_docs: "Files and docs"
- calendar: "Calendar events"
- contacts: "Contacts"
- app_activity: "App interactions", "In-app search history", "Installed apps"
- web_browsing: "Web browsing history"
- app_info_performance: "Crash logs", "Diagnostics", "Other app performance data"
- device_ids: "Device or other IDs"

Valid purposes: "app_functionality", "analytics", "developer_communications", "advertising_marketing", "fraud_prevention", "personalization", "account_management"

Rules:
- "collected" = true if the app collects this data
- "shared" = true if the app shares this data with third parties
- "ephemeral" = true if data is processed ephemerally (not stored)
- "required" = true if users cannot use the app without providing this data
- Be realistic and thorough - include all data types implied by the description
- Include app_info_performance (crash logs) by default unless explicitly excluded
- Return a JSON array, no markdown, no explanations`;

		const systemPrompt = isAndroid ? gpSystemPrompt : iosSystemPrompt;

		const userPrompt = `App name: ${appName}

Description of data collection:
${description}

Generate the ${isAndroid ? "data safety" : "privacy declaration"} JSON array.`;

		log.info({ appName }, "Generating privacy declaration");

		const { content, model } = await AIService.callOpenRouter(
			workspaceId,
			systemPrompt,
			userPrompt,
			"generate",
		);

		// Try to extract JSON from the response
		let cleaned = content.trim();
		if (cleaned.startsWith("```")) {
			cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
		}

		// Validate it's valid JSON
		try {
			JSON.parse(cleaned);
		} catch {
			log.error(
				{ content },
				"AI returned invalid JSON for privacy declaration",
			);
			buildError("somethingWentWrong", {
				info: "AI returned invalid privacy declaration format",
			});
		}

		return { model, result: cleaned };
	}

	static async translateLocalization(
		workspaceId: string,
		appId: string,
		appName: string,
		platform: string,
		fields: Record<string, string>,
		sourceLanguage: string,
		targetLanguage: string,
		instructions?: string,
	): Promise<{ model: string; translations: Record<string, string> }> {
		const fieldEntries = Object.entries(fields).filter(
			([, v]) => v.trim().length > 0,
		);
		if (fieldEntries.length === 0) {
			return { model: DEFAULT_MODEL, translations: {} };
		}

		const isIos = platform === "ios";
		const limitFor = (key: string): number =>
			(LISTING_FIELDS as string[]).includes(key)
				? fieldLimit(key as ListingField, storePlatform(platform))
				: 4000;

		const fieldsBlock = fieldEntries
			.map(([key, value]) => {
				const rules = buildTranslationFieldRules(key);
				return `"${key}":\n${rules ? `[Rules: ${rules}]\n` : `[Limit: ${limitFor(key)} characters]\n`}"""${value}"""`;
			})
			.join("\n\n");
		const platformLabel = isIos ? "iOS (App Store)" : "Android (Google Play)";

		const asoProfile = appId ? await AsoProfileService.get(appId) : null;
		const asoContext = asoProfile ? buildAsoContext(asoProfile) : "";

		const platformRules = isIos
			? `Store facts - Apple App Store:
- The title, subtitle and keyword field are indexed together; a word used in one must not appear in another.
- The description and promotional text are not indexed: translate them for conversion.
- The keyword field is a list of what people in the target market search for, not a translation of the source list.
- A storefront indexes several localizations at once (the US indexes English (U.S.) and Spanish (Mexico); most European storefronts index the local language and English (U.K.)). When the target is a secondary localization of a storefront, its title phrase, subtitle and keyword field are extra budget for that storefront: fill them with searched terms the primary localization does not already cover.`
			: `Store facts - Google Play:
- The title, short description and full description are all indexed; the short description weighs most after the title.
- The market's primary phrase belongs in the first sentence of the full description and may recur naturally three to five times, never as a list.
- There is no keyword field: the searched phrases live in the title, short description and full description.`;

		let systemPrompt = `You are a senior App Store Optimization localizer. A localization is a rewrite for another market: the same store limits and policies, the phrases people there actually search for, and copy that reads as if it had been written in that language first.

Character limits are hard limits:
- Every field states its limit. Count the characters of your translation; if it is over, shorten by cutting words - never truncate mid-sentence.
- For 30-character fields (title, subtitle) every character counts: prefer one strong phrase to two weak ones.

Market adaptation:
- Search terms differ by market. Use the phrase people in the target market type into the store, even when it is not the literal translation of the source (a literal "Audio Guides & Discoveries" in Polish is not what a Polish user searches for).
- Adapt idioms, humor, examples, formality and urgency to the target culture; drop a reference that does not exist there instead of translating it literally.
- Keep the brand name exactly as it is; keep bullet lines, line breaks and the structure (opening, benefits, proof, close).
- Benefits before features, active voice, the register the target market expects.
- Every field must stand on its own as native marketing copy.

When the target is another locale of the same language (en-GB, en-AU, pt-BR, es-MX, fr-CA), do not return the source unchanged: adapt spelling, vocabulary, units, prices and above all the search terms to that market ("holiday" not "vacation" for en-GB, "celular" for pt-BR). The keyword field is rebuilt around what that market searches.

Store policies apply to translations as much as to the source: no competitor or third-party brand names in the title, subtitle, short description or keyword field; no promotional or ranking words in titles ("best", "#1", "free", "top"); no other platforms named in App Store metadata; no anonymous user testimonials on Google Play. ${PLAIN_TEXT}

${platformRules}`;

		if (asoContext) {
			systemPrompt += `

App context (use to maintain brand voice and tone):
${asoContext}`;
		}

		if (asoProfile?.wordsToInclude?.length) {
			systemPrompt += `\n\nWords/phrases to include where natural (never a brand or trademark, never a promotional word): ${asoProfile.wordsToInclude.join(", ")}`;
		}
		if (asoProfile?.wordsToAvoid?.length) {
			systemPrompt += `\nWords/phrases to AVOID: ${asoProfile.wordsToAvoid.join(", ")}`;
		}

		if (instructions?.trim()) {
			systemPrompt += `\n\nAdditional instructions from the user. Follow them for terminology, tone, register and phrasing; they override the style defaults above. They never override the character limits or the store policies (no competitor or third-party names, no promotional or ranking words, no emoji or symbols, no other platforms, nothing untrue) - if an instruction conflicts with those, keep the store rule.\n${instructions.trim()}`;
		}

		systemPrompt +=
			"\n\nReturn ONLY valid JSON where keys match the input field names and values are translated content. No explanations, no markdown, just the JSON object.";

		const userPrompt = `App: ${appName}
Platform: ${platformLabel}
Translate from ${sourceLanguage} to ${targetLanguage}:

${fieldsBlock}

Return ONLY a JSON object with the same keys and translated values.`;

		log.info(
			{
				appId,
				fieldCount: fieldEntries.length,
				sourceLanguage,
				targetLanguage,
			},
			"Translating localization fields",
		);

		const { content, model } = await AIService.callOpenRouter(
			workspaceId,
			systemPrompt,
			userPrompt,
			"generate",
		);

		try {
			const translations = JSON.parse(extractJsonObject(content)) as Record<
				string,
				string
			>;

			for (const [key, value] of Object.entries(translations)) {
				if (typeof value !== "string") continue;
				const normalized = stripEmoji(value);
				const limit = limitFor(key);
				translations[key] =
					normalized.length > limit
						? truncateToLimit(normalized, limit, key)
						: normalized;
			}

			return { model, translations };
		} catch {
			log.error({ content }, "Failed to parse translation response");
			buildError("somethingWentWrong", {
				info: "AI returned invalid translation format",
			});
		}
	}

	static async generateReleaseNotes(
		workspaceId: string,
		appName: string,
		_version: string,
		changes: string[],
		options: { language?: string; platform?: string } = {},
	) {
		// Generate mode with the changes as the brief: rephrase mode would tell
		// the model to keep a raw change list as it is.
		const { model, result } = await AIService.generateListingField(
			workspaceId,
			"whatsNew",
			"",
			appName,
			options.platform ?? "ios",
			options.language ?? "en-US",
			undefined,
			{ brief: changes.join("\n") },
		);
		return { model, releaseNotes: result };
	}

	static async suggestCategory(
		workspaceId: string,
		appId: string,
		appName: string,
		platform: string,
		description?: string,
	): Promise<{
		model: string;
		primary: string;
		reasoning: string;
		secondary: string | null;
	}> {
		const asoProfile = appId ? await AsoProfileService.get(appId) : null;
		const asoContext = asoProfile ? buildAsoContext(asoProfile) : "";

		const isIos = platform === "ios";
		const categories: ReadonlyArray<{ id: string; name: string }> = isIos
			? APP_STORE_CATEGORIES
			: GOOGLE_PLAY_CATEGORIES;
		const categoryList = categories
			.map((c) => `${c.id} (${c.name})`)
			.join(", ");
		const validIds = new Set(categories.map((c) => c.id));

		const systemPrompt = `You are an ASO strategist choosing store categories. The category decides which charts an app competes in and which "you might also like" rails it appears on, so the choice is about where the app can rank, not only what it is.

Store: ${isIos ? "Apple App Store" : "Google Play"}
Available categories (use these ids exactly): ${categoryList}

Rules:
- The primary category is where people looking for this app browse and where its direct competitors sit; pick the category the app's core use case belongs to.
- ${isIos ? "The secondary category covers a real second use case; return null when none fits honestly. For games choose GAMES and name the two most fitting game subcategories in the reasoning." : "Google Play has one application category and no secondary: always return secondary: null. Mention up to five relevant Play tags in the reasoning."}
- Prefer the category the app genuinely belongs to over a less crowded one: a mis-filed app loses "similar apps" traffic and can be rejected in review.
- Do not choose Kids or Medical unless the description makes the app clearly a children's app or a medical tool; both carry extra review requirements (Apple 5.1.4 and 1.4.1, Play Families policy).
- Return ONLY valid JSON with this exact structure: {"primary": "CATEGORY_ID", "secondary": "CATEGORY_ID" or null, "reasoning": "one or two sentences"}`;

		const userPrompt = `App name: ${appName}
Platform: ${platform === "ios" ? "iOS (App Store)" : "Android (Google Play)"}
${description ? `Description: ${description}` : ""}
${asoContext ? `\nASO Profile:\n${asoContext}` : ""}

Suggest the best primary and secondary category. Return ONLY the JSON.`;

		log.info({ appId, appName }, "Suggesting categories with AI");

		const { content, model } = await AIService.callOpenRouter(
			workspaceId,
			systemPrompt,
			userPrompt,
			"research",
		);

		let result: {
			primary: string;
			reasoning: string;
			secondary: string | null;
		};
		try {
			result = JSON.parse(extractJsonObject(content)) as typeof result;
		} catch {
			log.error(
				{ content },
				"AI returned invalid JSON for category suggestion",
			);
			buildError("somethingWentWrong", {
				info: "AI returned invalid category suggestion format",
			});
		}
		// The ids go straight into a store form: an id the store does not have
		// is worse than no answer.
		if (!validIds.has(result.primary)) {
			buildError("somethingWentWrong", {
				info: `AI proposed a category this store does not have: ${result.primary}`,
			});
		}
		const secondary =
			isIos &&
			result.secondary &&
			validIds.has(result.secondary) &&
			result.secondary !== result.primary
				? result.secondary
				: null;
		return {
			model,
			primary: result.primary,
			reasoning: String(result.reasoning ?? ""),
			secondary,
		};
	}

	static async generateAgeRating(
		workspaceId: string,
		appId: string,
	): Promise<{
		appleQuestionnaire: Record<string, string>;
		appleRating: string;
		googleQuestionnaire: Record<string, string | boolean>;
		model: string;
		presetId: string;
		reasoning: string;
	}> {
		// Fetch app info
		const [app] = await db
			.select()
			.from(apps)
			.where(eq(apps.id, appId))
			.limit(1);

		if (!app) buildError("notFound", { info: "App not found" });

		// Fetch listing (prefer English, fallback to first available)
		const appListings = await db
			.select()
			.from(listings)
			.where(eq(listings.appId, appId));

		const listing =
			appListings.find((l) => l.language.startsWith("en")) ??
			appListings[0] ??
			null;

		// Fetch ASO profile for additional context
		const asoProfile = await AIService.resolveAsoProfile(appId);

		const appContext = [
			`App name: ${app.name}`,
			`Platform: ${app.platform === "ios" ? "iOS" : "Android"}`,
			app.primaryCategory ? `Category: ${app.primaryCategory}` : null,
			listing?.fullDesc
				? `Description: ${listing.fullDesc.substring(0, 1500)}`
				: null,
			asoProfile?.keyFeatures?.length
				? `Key features: ${asoProfile.keyFeatures.join(", ")}`
				: null,
			asoProfile?.targetAudience
				? `Target audience: ${asoProfile.targetAudience}`
				: null,
		]
			.filter(Boolean)
			.join("\n");

		const systemPrompt = `You are an expert app content classifier specializing in age rating declarations for Apple App Store and Google Play.

Given information about a mobile app, determine the appropriate age rating by answering the content questionnaire.

For Apple, answer each question with one of: "NONE", "INFREQUENT_MILD", "FREQUENT_INTENSE"
These are the Apple content questions:
- CARTOON_FANTASY_VIOLENCE: Cartoon or Fantasy Violence
- REALISTIC_VIOLENCE: Realistic Violence
- PROLONGED_GRAPHIC_SADISTIC_REALISTIC_VIOLENCE: Prolonged Graphic or Sadistic Realistic Violence
- PROFANITY_CRUDE_HUMOR: Profanity or Crude Humor
- MATURE_SUGGESTIVE: Mature/Suggestive Themes
- HORROR_FEAR_THEMES: Horror/Fear Themes
- MEDICAL_TREATMENT_INFO: Medical/Treatment Information
- ALCOHOL_TOBACCO_DRUG_USE: Alcohol, Tobacco, or Drug Use or References
- SIMULATED_GAMBLING: Simulated Gambling
- SEXUAL_CONTENT_NUDITY: Sexual Content or Nudity
- GRAPHIC_SEXUAL_CONTENT_NUDITY: Graphic Sexual Content and Nudity
- UNRESTRICTED_WEB_ACCESS: Unrestricted Web Access
- GAMBLING_CONTESTS: Gambling and Contests
- LOOT_BOX: Loot Boxes
- CONTESTS: Contests
- HEALTH_OR_WELLNESS_TOPICS: Health or Wellness Topics
- GUNS_OR_OTHER_WEAPONS: Guns or Other Weapons
- USER_GENERATED_CONTENT: User Generated Content
- PARENTAL_CONTROLS: Parental Controls
- GAMBLING: Gambling
- ADVERTISING: Advertising
- AGE_ASSURANCE: Age Assurance
- MESSAGING_AND_CHAT: Messaging and Chat

For Google Play, provide these fields:
- violence: "none" | "mild" | "moderate" | "intense"
- sexual_content: "none" | "mild" | "moderate"
- profanity: "none" | "mild" | "strong"
- drugs: "none" | "reference" | "use"
- gambling: boolean
- user_interaction: boolean
- shares_location: boolean
- contains_ads: boolean

Rules:
- Be conservative - when in doubt, rate higher rather than lower
- Productivity, utility, and educational apps with no objectionable content should be "everyone"
- Social apps with user-generated content need appropriate UGC and messaging flags
- Games should carefully evaluate violence, loot boxes, and gambling elements
- Health/medical apps should flag HEALTH_OR_WELLNESS_TOPICS and MEDICAL_TREATMENT_INFO
- Apps with ads should flag ADVERTISING
- Apps with chat/messaging should flag MESSAGING_AND_CHAT

Return ONLY valid JSON with this exact structure:
{
  "presetId": "everyone" | "everyone_mild" | "teen" | "mature",
  "appleQuestionnaire": { ... all 23 questions with values ... },
  "googleQuestionnaire": { ... all 8 fields ... },
  "reasoning": "Brief explanation of the classification"
}`;

		const { content, model } = await AIService.callOpenRouter(
			workspaceId,
			systemPrompt,
			appContext,
			"generate",
		);

		let cleaned = content.trim();
		if (cleaned.startsWith("```")) {
			cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
		}

		try {
			const result = JSON.parse(cleaned) as {
				appleQuestionnaire: Record<string, string>;
				googleQuestionnaire: Record<string, string | boolean>;
				presetId: string;
				reasoning: string;
			};

			// Import computeAppleRating dynamically to avoid circular deps
			const { computeAppleRating } = await import(
				"@/modules/age-rating/age-rating.templates"
			);
			const appleRating = computeAppleRating(result.appleQuestionnaire);

			return {
				appleQuestionnaire: result.appleQuestionnaire,
				appleRating,
				googleQuestionnaire: result.googleQuestionnaire,
				model,
				presetId: result.presetId,
				reasoning: result.reasoning,
			};
		} catch {
			log.error(
				{ content },
				"AI returned invalid JSON for age rating generation",
			);
			buildError("somethingWentWrong", {
				info: "AI returned invalid age rating format",
			});
		}
	}
}

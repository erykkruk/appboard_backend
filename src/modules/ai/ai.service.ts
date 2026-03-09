import { and, eq } from "drizzle-orm";
import { APP_STORE_CATEGORIES } from "@/config/const";
import {
	buildTranslationFieldRules,
	getSettingKey,
	type PromptMode,
} from "@/modules/ai/ai.prompts";
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

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

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

function stripEmoji(text: string): string {
	return text
		.replace(/\p{Emoji_Presentation}/gu, "")
		.replace(/\p{Extended_Pictographic}/gu, "")
		.replace(/\uFE0F/g, "")
		.replace(/\u200D/g, "")
		.replace(/\s{2,}/g, " ")
		.trim();
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

const FIELD_CHAR_LIMITS: Record<ListingField, number> = {
	description: 4000,
	fullDescription: 4000,
	keywords: 100,
	promotionalText: 170,
	shortDescription: 80,
	subtitle: 30,
	title: 30,
	whatsNew: 4000,
};

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

function buildSystemPrompt(field: ListingField, platform: string): string {
	const isIos = platform === "ios";

	const core = `You are an expert ASO (App Store Optimization) copywriter with deep knowledge of 2025-2026 store algorithms.

IMPORTANT: NEVER use emoji or special Unicode symbols in any field. App Store Connect rejects content with emoji characters.

Core principles:
- Clarity > cleverness — always prefer clear, direct language
- Benefits > features — focus on what the user gains, not what the app does
- Specificity > vagueness — use concrete metrics and outcomes ("Save 2 hours/week" not "Save time")
- Natural language — algorithms penalize keyword stuffing; write for humans first
- Address the persona directly — use "you/your", reference their specific situation
- Conversion psychology: users decide in ~50ms; lead with strongest hook, use loss aversion ("Don't miss..."), social proof, and peak-end rule (strong opening + strong closing)`;

	const platformRules = isIos
		? `
Platform: iOS (App Store)
- Title + Subtitle = highest ranking weight; keyword field complements them
- NEVER repeat words across title, subtitle, and keyword field — each word counts only once
- Description is NOT indexed for search — write purely for conversion
- Apple Intelligence generates review summaries shown to users — write content that feeds positive AI summaries
- Promotional Text can be updated without review and is NOT indexed`
		: `
Platform: Android (Google Play)
- Title = highest ranking weight; Short Description = second highest (heavily indexed)
- Long Description IS indexed — weave primary keywords 3-5x naturally throughout
- Google's Gemini AI generates listing summaries — write content that feeds positive AI summaries
- Android Vitals (crashes, ANRs) penalize search ranking — mention stability/performance if relevant
- No keyword field exists — all keyword strategy goes into title, short description, and long description`;

	const fieldInstructions = buildFieldInstructions(field, isIos);

	return `${core}\n${platformRules}\n\n${fieldInstructions}`;
}

function buildFieldInstructions(field: ListingField, isIos: boolean): string {
	switch (field) {
		case "title":
			return `You are writing an APP TITLE (max 30 characters).
Formula: [Brand] — [Primary Keyword + Benefit] or [Brand]: [What it does]
- Must include brand name
- Include highest-value keyword naturally
- Do NOT use generic words like "app", "best", "free", "#1" unless part of the brand
- Title is the STRONGEST ranking signal on both platforms`;

		case "subtitle":
			return `You are writing an iOS APP SUBTITLE (max 30 characters).
The subtitle is the SECOND strongest ranking factor on iOS.
Formula: [Action Verb] + [Specific Outcome] or [Key Benefit Statement]
- NEVER repeat words from the title — each word is indexed independently
- Use this to capture keywords that didn't fit in the title
- Complement the title's promise with specificity
- Front-load the most important keyword`;

		case "shortDescription":
			return `You are writing an Android SHORT DESCRIPTION (max 80 characters).
This is the SECOND strongest ranking factor on Google Play — heavily indexed by the algorithm.
Formula: [Action Verb] + [Core Benefit] + [Key Differentiator]
- Front-load the primary keyword within the first 3-4 words
- Must be compelling enough to stop scrolling (visible before "Read More")
- Include 1-2 high-value keywords naturally
- NEVER just repeat the title — expand on it with complementary keywords`;

		case "description": {
			const platformDesc = isIos
				? `This description is NOT indexed for search on iOS — focus 100% on conversion.`
				: `This description IS indexed on Google Play — weave primary keywords 3-5x naturally.
Balance SEO (keyword placement) with conversion (compelling copy). Front-load keywords in the first paragraph.`;

			return `You are writing an APP DESCRIPTION (max 4000 characters).
${platformDesc}

Structure (HOOK-BENEFIT-PROOF-CTA):
1. HOOK (first 3 lines, visible before "Read More"):
   - Address the reader's pain point directly.
   - Include primary keyword naturally.
2. BENEFIT BLOCK:
   - 4-6 key benefits with bullet points
   - Each bullet: [Benefit] — [how it works briefly]
3. WHAT MAKES IT UNIQUE:
   - 2-3 differentiators competitors lack
4. SOCIAL PROOF (if data available):
   - Download counts, ratings, awards, press quotes
5. CTA:
   - Clear call to action.

No keyword stuffing — max 3-5 natural repetitions of main keyword.`;
		}

		case "keywords":
			return `You are writing iOS APP STORE KEYWORDS (max 100 characters).
This field is iOS-only and is a powerful ranking signal.
- NEVER repeat words already in the title or subtitle
- Singular forms only (Apple handles plural matching)
- No spaces after commas (maximize character usage)
- Separate with commas, no hashtags or special characters
- Mix high-volume head terms with specific long-tail terms
- Prioritize by: relevance > search volume > competition`;

		case "promotionalText":
			return `You are writing iOS PROMOTIONAL TEXT (max 170 characters).
This appears above the description on iOS. NOT indexed for search.
Purpose: Drive conversions and highlight timely information.
Formula: [What's New/Special] + [Benefit to User]
- Can be updated anytime without app review
- Focus on urgency or excitement`;

		case "whatsNew":
			return `You are writing WHAT'S NEW / RELEASE NOTES (max 4000 characters).
Release notes influence AI-generated review summaries (Apple Intelligence / Gemini).
- Lead with the most exciting new feature or improvement
- List changes as bullet points
- Each bullet: [What changed] — [benefit to user]
- Mention bug fixes briefly
- End with a CTA: invite users to rate/review
- Positive framing: "Now 2x faster" not "Fixed slow loading"`;

		// fullDescription is resolved to "description" by resolveFieldForPlatform,
		// so this case should not be reached, but TypeScript requires exhaustiveness
		case "fullDescription":
			return buildFieldInstructions("description", false);
	}
}

async function resolvePrompt(
	field: ListingField,
	mode: PromptMode,
	platform: string,
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
	const settingKey = getSettingKey(field, mode);
	const globalPrompt = await SettingsService.getRaw(workspaceId, settingKey);
	if (globalPrompt) return globalPrompt;

	// 3. Built-in default (platform-aware)
	return buildSystemPrompt(field, platform);
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
): string {
	const charLimit = FIELD_CHAR_LIMITS[field];
	const fieldLabel = FIELD_LABELS[field];
	const isRephrase = !!currentValue;

	let prompt = `App name: ${appName}
Platform: ${platform === "ios" ? "iOS (App Store)" : "Android (Google Play)"}
Language: ${language}
Field: ${fieldLabel}
Maximum characters: ${charLimit}

ASO Profile:
${asoContext || "No ASO profile provided — use the app name and general best practices."}
`;

	if (asoProfile?.targetAudience || asoProfile?.painPoints?.length) {
		prompt += "\nPersona Instructions:\n";
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

	if (isRephrase) {
		prompt += `
Current text to rephrase:
"""
${currentValue}
"""

TASK: Rephrase the text above to improve its ASO effectiveness while keeping the same core meaning and information. Write in the SAME LANGUAGE as the current text. Stay within ${charLimit} characters.`;
	} else {
		prompt += `
TASK: Generate ${fieldLabel} for this app. Write in ${language} language. Stay within ${charLimit} characters.`;
	}

	prompt +=
		"\n\nIMPORTANT: Return ONLY the generated text, no explanations, no quotes, no labels. Just the raw content. Do NOT include any emoji or special Unicode symbols.";

	return prompt;
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

type AiPurpose = "generate" | "rephrase" | "research";

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

	private static async callOpenRouter(
		workspaceId: string,
		systemPrompt: string,
		userPrompt: string,
		purpose: AiPurpose = "generate",
	): Promise<{ content: string; model: string }> {
		const apiKey = await SettingsService.getRaw(
			workspaceId,
			"OPENROUTER_API_KEY",
		);
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
				temperature: 0.7,
			}),
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => "Unknown error");
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

	static async generateListingField(
		workspaceId: string,
		field: ListingField,
		appId: string,
		appName: string,
		platform: string,
		language: string,
		currentValue?: string,
	): Promise<{ model: string; result: string }> {
		const resolvedField = resolveFieldForPlatform(field, platform);

		const asoProfile = await AIService.resolveAsoProfile(appId);
		const asoContext = asoProfile ? buildAsoContext(asoProfile) : "";

		const mode: PromptMode = currentValue ? "rephrase" : "generate";
		const systemPrompt = await resolvePrompt(
			resolvedField,
			mode,
			platform,
			workspaceId,
			appId || undefined,
		);
		const userPrompt = buildUserPrompt(
			resolvedField,
			appName,
			platform,
			language,
			asoContext,
			currentValue,
			asoProfile,
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
		const charLimit = FIELD_CHAR_LIMITS[resolvedField];
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
		const systemPrompt = `You are a professional ASO translator specializing in app store content.

Your job is market adaptation, NOT literal translation. The translated text must:
- Sound natural and fluent — as if originally written in the target language
- Maintain marketing tone and ASO effectiveness
- Make sense contextually — never produce nonsensical literal translations
- Adapt idioms, cultural references, and marketing phrases to what resonates in the target market
- Preserve the intent and emotional impact of the original

IMPORTANT: NEVER use emoji or special Unicode symbols.`;
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
			const translations = JSON.parse(content) as Record<string, string>;
			return { model, translations };
		} catch {
			log.error({ content }, "Failed to parse translation response");
			buildError("somethingWentWrong", {
				info: "AI returned invalid translation format",
			});
		}
	}

	static async generateDescription(
		workspaceId: string,
		appName: string,
		_prompt: string,
		platform?: string,
		_keywords?: string[],
	) {
		const { model, result } = await AIService.generateListingField(
			workspaceId,
			"description",
			"",
			appName,
			platform ?? "ios",
			"en-US",
		);
		return { description: result, model };
	}

	static async suggestKeywords(
		workspaceId: string,
		appName: string,
		description?: string,
		category?: string,
		currentKeywords?: string[],
	) {
		const systemPrompt = `You are an ASO keyword research expert with deep knowledge of app store search algorithms (2025-2026).

Keyword Strategy:
- Organize keywords into semantic clusters for comprehensive coverage
- Mix head terms (high volume, competitive) with long-tail (specific, lower competition)
- Consider user intent: what would someone search to find this app?
- Include action verbs, problem descriptions, and solution terms
- Singular forms preferred (stores handle pluralization)
- Consider competitor names and alternative phrasings
- Think about adjacent categories and use cases`;

		const userPrompt = `App: ${appName}
${description ? `Description: ${description}` : ""}
${category ? `Category: ${category}` : ""}
${currentKeywords?.length ? `Current keywords: ${currentKeywords.join(", ")}` : ""}

Suggest keywords organized into semantic clusters. Return ONLY a JSON object with this exact structure:
{
  "feature": ["keywords describing app features"],
  "problem": ["keywords describing problems the app solves"],
  "category": ["category and niche keywords"],
  "alternative": ["competitor alternatives and comparison terms"],
  "longTail": ["specific multi-word phrases users might search"]
}

Each cluster should have 3-5 keywords. Total ~15-20 keywords.`;

		const { content, model } = await AIService.callOpenRouter(
			workspaceId,
			systemPrompt,
			userPrompt,
			"research",
		);

		try {
			const clusters = JSON.parse(content) as Record<string, string[]>;
			const keywords = Object.values(clusters).flat();
			return { clusters, keywords, model };
		} catch {
			const keywords = content.split(",").map((k: string) => k.trim());
			return { clusters: { uncategorized: keywords }, keywords, model };
		}
	}

	static async draftReply(
		workspaceId: string,
		reviewText: string,
		rating: number,
		authorName: string,
		tone?: string,
	) {
		const systemPrompt = `You are a customer support specialist writing app store review replies. Use the AAAA+I empathy framework:

1. ACKNOWLEDGE — Validate the user's experience.
2. APPRECIATE — Thank them for taking time to write feedback.
3. ADDRESS — Respond to their specific issue or praise with concrete details.
4. ACT — State what you're doing about it (for issues) or what's coming next (for praise).
5. INVITE — End with an invitation for further contact or to update their review.

Key principles:
- Personalize: use the reviewer's name, reference specific details from their review
- Be concise: 2-4 sentences max
- Never be defensive or dismissive, even for unfair reviews
- Professional but warm tone`;

		const isPositive = rating >= 4;
		const userPrompt = `Review by ${authorName} (${rating}/5 stars):
"${reviewText}"

${tone ? `Desired tone: ${tone}` : ""}

Write a ${isPositive ? "thankful, encouraging reply that reinforces their positive experience" : "empathetic, solution-oriented reply following the AAAA+I framework"}. Keep it concise (2-4 sentences). Return ONLY the reply text.`;

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
- Be realistic and thorough — include all data types implied by the description
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
- Be realistic and thorough — include all data types implied by the description
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
	): Promise<{ model: string; translations: Record<string, string> }> {
		const fieldEntries = Object.entries(fields).filter(
			([, v]) => v.trim().length > 0,
		);
		if (fieldEntries.length === 0) {
			return { model: DEFAULT_MODEL, translations: {} };
		}

		const fieldLimits: Record<string, number> = {
			description: 4000,
			fullDescription: 4000,
			keywords: 100,
			promotionalText: 170,
			shortDescription: 80,
			subtitle: 30,
			title: 30,
			whatsNew: 4000,
		};

		const fieldsBlock = fieldEntries
			.map(([key, value]) => {
				const limit = fieldLimits[key] ?? 4000;
				const rules = buildTranslationFieldRules(key);
				return `"${key}" (max ${limit} chars):\n${rules ? `[Rules: ${rules}]\n` : ""}"""${value}"""`;
			})
			.join("\n\n");

		const isIos = platform === "ios";
		const platformLabel = isIos ? "iOS (App Store)" : "Android (Google Play)";

		const asoProfile = appId ? await AsoProfileService.get(appId) : null;
		const asoContext = asoProfile ? buildAsoContext(asoProfile) : "";

		const platformRules = isIos
			? `Platform-specific:
- Title + Subtitle + Keywords are indexed separately — NEVER repeat words across them
- Description is NOT indexed — optimize translated description purely for conversion
- Keywords field: find high-volume search terms in the target language, not literal translations`
			: `Platform-specific:
- Title + Short Description + Long Description are ALL indexed
- Weave primary keywords 3-5x naturally in the translated description
- No keyword field exists — all keyword strategy goes into title, short description, and description`;

		let systemPrompt = `You are an expert ASO (App Store Optimization) translator with deep knowledge of 2025-2026 store algorithms.

Your job is NOT literal translation — it is MARKET ADAPTATION. You translate app store content so it ranks well and converts in the target market.

IMPORTANT: NEVER use emoji or special Unicode symbols in any field.

CRITICAL — CHARACTER LIMITS:
- Each field has a strict character limit shown in parentheses (e.g. "max 30 chars")
- You MUST count characters and ensure EVERY translated value fits within its limit
- If a direct translation is too long, shorten it — use fewer words, abbreviate, or rephrase more concisely
- NEVER exceed the character limit. A shorter, complete translation is always better than a truncated one
- For 30-char fields (title, subtitle): every character is precious — be concise and impactful

Core principles:
- Find what users in the target market ACTUALLY search for — do NOT just translate source keywords word-for-word
- The translated text MUST make sense as natural, fluent copy in the target language — never sound like machine translation
- Adapt marketing tone and cultural references to the target audience
- Preserve ASO structure (hooks, benefits, CTAs) while making it natural in the target language
- Preserve formatting (bullet points, line breaks)
- Benefits over features — focus on what the user gains, not what the app does
- Active voice — use action verbs natural in the target language
- Each field must work as standalone marketing copy — it should sound like it was originally written in the target language

Localization is NOT just translation:
- Users search differently in every language — adapt keywords to local search behavior
- Cultural adaptation: humor, idioms, urgency level, formality — all vary by market
- Some concepts do not translate directly — find the equivalent that resonates locally
- Example: "Audio Guides & Discoveries" translated literally to Polish sounds nonsensical — instead adapt to what Polish users would search for and understand

${platformRules}`;

		if (asoContext) {
			systemPrompt += `

App context (use to maintain brand voice and tone):
${asoContext}`;
		}

		if (asoProfile?.wordsToInclude?.length) {
			systemPrompt += `\n\nWords/phrases to include where natural: ${asoProfile.wordsToInclude.join(", ")}`;
		}
		if (asoProfile?.wordsToAvoid?.length) {
			systemPrompt += `\nWords/phrases to AVOID: ${asoProfile.wordsToAvoid.join(", ")}`;
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

		let cleaned = content.trim();
		if (cleaned.startsWith("```")) {
			cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
		}

		try {
			const translations = JSON.parse(cleaned) as Record<string, string>;

			for (const [key, value] of Object.entries(translations)) {
				const limit = fieldLimits[key];
				if (limit && value.length > limit) {
					translations[key] = truncateToLimit(value, limit, key);
				}
			}

			return { model, translations };
		} catch {
			log.error({ content }, "Failed to parse translation response");
			buildError("somethingWentWrong", {
				info: "AI returned invalid translation format",
			});
			throw new Error("unreachable");
		}
	}

	static async generateReleaseNotes(
		workspaceId: string,
		appName: string,
		_version: string,
		changes: string[],
	) {
		const { model, result } = await AIService.generateListingField(
			workspaceId,
			"whatsNew",
			"",
			appName,
			"ios",
			"en-US",
			changes.join("\n"),
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

		const categoryList = APP_STORE_CATEGORIES.map(
			(c) => `${c.id} (${c.name})`,
		).join(", ");

		const systemPrompt = `You are an ASO expert specializing in app categorization. Your job is to suggest the best primary and secondary App Store categories for an app.

Available categories: ${categoryList}

Rules:
- Primary category should be the most relevant to the app's core functionality
- Secondary category should capture a secondary use case (or null if none fits well)
- Consider both discoverability (where users would search) and competition (less crowded categories rank higher)
- Return ONLY valid JSON with this exact structure: {"primary": "CATEGORY_ID", "secondary": "CATEGORY_ID" or null, "reasoning": "brief explanation"}`;

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

		let cleaned = content.trim();
		if (cleaned.startsWith("```")) {
			cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
		}

		try {
			const result = JSON.parse(cleaned) as {
				primary: string;
				reasoning: string;
				secondary: string | null;
			};
			return { model, ...result };
		} catch {
			log.error(
				{ content },
				"AI returned invalid JSON for category suggestion",
			);
			buildError("somethingWentWrong", {
				info: "AI returned invalid category suggestion format",
			});
			throw new Error("unreachable");
		}
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

		if (!app) {
			buildError("notFound", { info: "App not found" });
			throw new Error("unreachable");
		}

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
- Be conservative — when in doubt, rate higher rather than lower
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
			throw new Error("unreachable");
		}
	}
}

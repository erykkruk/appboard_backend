import { and, eq } from "drizzle-orm";
import { APP_STORE_CATEGORIES } from "@/config/const";
import {
	buildTranslationFieldRules,
	getSettingKey,
	type PromptMode,
} from "@/modules/ai/ai.prompts";
import { AsoProfileService } from "@/modules/aso-profile/aso-profile.service";
import { SettingsService } from "@/modules/settings/settings.service";
import { db } from "@/utils/db";
import { appAiPrompts } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("ai-service");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.0-flash-001";

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
	| "keywords"
	| "promotionalText"
	| "whatsNew";

export type { ListingField };

const FIELD_CHAR_LIMITS: Record<ListingField, number> = {
	description: 4000,
	keywords: 100,
	promotionalText: 170,
	shortDescription: 80,
	subtitle: 30,
	title: 30,
	whatsNew: 4000,
};

const FIELD_LABELS: Record<ListingField, string> = {
	description: "App Description",
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
	}
}

async function resolvePrompt(
	field: ListingField,
	mode: PromptMode,
	platform: string,
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
	const globalPrompt = await SettingsService.getRaw(settingKey);
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

type AiPurpose = "generate" | "rephrase" | "research";

const PURPOSE_SETTING_KEYS: Record<AiPurpose, string> = {
	generate: "AI_MODEL_GENERATE",
	rephrase: "AI_MODEL_REPHRASE",
	research: "AI_MODEL_RESEARCH",
};

export class AIService {
	private static async resolveModel(purpose: AiPurpose): Promise<string> {
		const settingKey = PURPOSE_SETTING_KEYS[purpose];
		const model = await SettingsService.getRaw(settingKey);
		return model || DEFAULT_MODEL;
	}

	private static async callOpenRouter(
		systemPrompt: string,
		userPrompt: string,
		purpose: AiPurpose = "generate",
	): Promise<{ content: string; model: string }> {
		const apiKey = await SettingsService.getRaw("OPENROUTER_API_KEY");
		if (!apiKey) {
			buildError("badRequest", {
				info: "OpenRouter API key not configured. Go to Settings to add it.",
			});
		}

		const selectedModel = await AIService.resolveModel(purpose);

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

	static async generateListingField(
		field: ListingField,
		appId: string,
		appName: string,
		platform: string,
		language: string,
		currentValue?: string,
	): Promise<{ model: string; result: string }> {
		const resolvedField = resolveFieldForPlatform(field, platform);

		const asoProfile = await AsoProfileService.get(appId);
		const asoContext = asoProfile ? buildAsoContext(asoProfile) : "";

		const mode: PromptMode = currentValue ? "rephrase" : "generate";
		const systemPrompt = await resolvePrompt(
			resolvedField,
			mode,
			platform,
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

	static async translate(text: string, targetLanguages: string[]) {
		const systemPrompt =
			"You are a professional translator specializing in app store content. Translate accurately while maintaining marketing tone and ASO effectiveness.";
		const userPrompt = `Translate the following text to these languages: ${targetLanguages.join(", ")}

Text:
"""
${text}
"""

Return a JSON object where keys are language codes and values are translations. Return ONLY the JSON, no explanations.`;

		const { content, model } = await AIService.callOpenRouter(
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
		appName: string,
		_prompt: string,
		platform?: string,
		_keywords?: string[],
	) {
		const { model, result } = await AIService.generateListingField(
			"description",
			"",
			appName,
			platform ?? "ios",
			"en-US",
		);
		return { description: result, model };
	}

	static async suggestKeywords(
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
			systemPrompt,
			userPrompt,
			"generate",
		);
		return { model, reply: content };
	}

	static async generatePrivacyDeclaration(
		appName: string,
		description: string,
	): Promise<{ model: string; result: string }> {
		const systemPrompt = `You are an expert in Apple App Store privacy declarations (App Privacy "nutrition labels").

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

		const userPrompt = `App name: ${appName}

Description of data collection:
${description}

Generate the privacy declaration JSON array.`;

		log.info({ appName }, "Generating privacy declaration");

		const { content, model } = await AIService.callOpenRouter(
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
			keywords: 100,
			promotionalText: 170,
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

Your job is NOT literal translation — it is market adaptation. You translate app store content so it ranks well and converts in the target market.

IMPORTANT: NEVER use emoji or special Unicode symbols in any field.

CRITICAL — CHARACTER LIMITS:
- Each field has a strict character limit shown in parentheses (e.g. "max 30 chars")
- You MUST count characters and ensure EVERY translated value fits within its limit
- If a direct translation is too long, shorten it — use fewer words, abbreviate, or rephrase more concisely
- NEVER exceed the character limit. A shorter, complete translation is always better than a truncated one

Core principles:
- Find what users in the target market ACTUALLY search for — do not just translate source keywords
- Adapt marketing tone and cultural references to the target audience
- Preserve ASO structure (hooks, benefits, CTAs) while making it natural in the target language
- Preserve formatting (bullet points, line breaks)

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
		appName: string,
		_version: string,
		changes: string[],
	) {
		const { model, result } = await AIService.generateListingField(
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
}

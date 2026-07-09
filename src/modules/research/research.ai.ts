import { type } from "arktype";
import config from "@/config";
import { extractOpenRouterMessage } from "@/modules/ai/ai.service";
import { SettingsService } from "@/modules/settings/settings.service";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import {
	type CompareAnalysis,
	RESEARCH_CATEGORIES,
	type ResearchAnalysis,
	type ResearchAppMeta,
	type ResearchReview,
	type VisualAnalysis,
} from "./research.types";

const log = createLogger("research-ai");

const OPENROUTER_URL =
	config.OPENROUTER_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL =
	config.OPENROUTER_MODEL ?? "google/gemini-3-flash-preview";
const MODEL_SETTING_KEY = "RESEARCH_MODEL";

const MAX_REVIEWS_SINGLE_PASS = 300;
const DEEP_CHUNK_SIZE = 150;
const DEEP_PARALLEL = 3;
const MAX_REVIEW_CHARS = 500;
const MAX_COMPARE_REVIEWS = 120;
const MAX_VISUAL_IMAGES = 6;
const TEMPERATURE = 0.2;
// Reasoning models (e.g. GLM 5.x) spend output tokens on thinking before the
// JSON answer — a low cap truncates the JSON mid-array ("Expected ']'").
const MAX_TOKENS = 24000;

const analysisSchema = type({
	asoKeywords: type({ keyword: "string", reason: "string" }).array(),
	categories: type({
		count: "number",
		id: "string",
		insight: "string",
		quotes: "string[]",
		severity: "'low' | 'medium' | 'high'",
	}).array(),
	featuresHated: type({
		insight: "string",
		mentions: "number",
		name: "string",
	}).array(),
	featuresLoved: type({
		insight: "string",
		mentions: "number",
		name: "string",
	}).array(),
	metadataTips: "string[]",
	quickWins: "string[]",
	sentiment: { negative: "number", neutral: "number", positive: "number" },
	summary: "string",
	topIrritations: "string[]",
});

const visualSchema = type({
	conversionTips: "string[]",
	iconVerdict: "string",
	screenshotFindings: "string[]",
});

const compareSchema = type({
	featureGaps: "string[]",
	theyDoBetter: "string[]",
	verdict: "string",
	weDoBetter: "string[]",
});

const ANALYSIS_JSON_SPEC = (catIds: string) => `{
  "summary": "3-5 sentences in English: the overall picture — what hurts users the most, what they praise, what the trend is",
  "sentiment": { "positive": <number of 4-5★ reviews>, "neutral": <3★>, "negative": <1-2★> },
  "categories": [
    {
      "id": "<one of: ${catIds}>",
      "count": <how many reviews concern this category>,
      "severity": "low" | "medium" | "high",
      "insight": "1-2 sentences in English: what specifically recurs",
      "quotes": ["max 3 verbatim, short quotes"]
    }
  ],
  "featuresLoved": [
    { "name": "<specific app feature>", "mentions": <how many times praised>, "insight": "what exactly people value in it (in English)" }
  ],
  "featuresHated": [
    { "name": "<specific app feature>", "mentions": <how many times criticized>, "insight": "what exactly is annoying about it (in English)" }
  ],
  "topIrritations": ["5-8 things that annoy users the most, from the most frequent — in English, specific"],
  "quickWins": ["3-6 specific, technical recommendations in English, sorted by impact/effort"],
  "metadataTips": ["2-4 ASO tips regarding the app's title/subtitle/description in English (e.g. a missing phrase in the title, a proposal for a better subtitle — remember the 30-character limit)"],
  "asoKeywords": [
    { "keyword": "<1-3 word phrase in the language of the app's market>", "reason": "why" }
  ]
}`;

type MessageContent =
	| string
	| Array<
			| { type: "text"; text: string }
			| { type: "image_url"; image_url: { url: string } }
	  >;

function reviewLines(reviews: ResearchReview[], limit: number): string {
	return reviews
		.slice(0, limit)
		.map(
			(r, i) =>
				`${i + 1}. [${r.store === "appstore" ? "iOS" : "Android"}] ${r.stars}★ ${r.title ? `${r.title} — ` : ""}${r.text.slice(0, MAX_REVIEW_CHARS)}`,
		)
		.join("\n");
}

function metaBlock(meta: ResearchAppMeta[]): string {
	return meta
		.map(
			(m) =>
				`${m.store === "appstore" ? "App Store" : "Google Play"}: "${m.title}" (${m.developer}), rating ${m.rating?.toFixed(2) ?? "?"} from ${m.ratingsCount ?? "?"} ratings, version ${m.version ?? "?"}.\nDescription (excerpt): ${(m.description ?? "").slice(0, 600)}`,
		)
		.join("\n\n");
}

export function extractJson(content: string): string {
	const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenced) return fenced[1].trim();
	const start = content.indexOf("{");
	const end = content.lastIndexOf("}");
	if (start === -1 || end === -1) {
		buildError("storeApiError", { info: "AI model did not return JSON" });
	}
	return content.slice(start, end + 1);
}

async function getApiKey(workspaceId: string): Promise<string> {
	const apiKey = await SettingsService.getRaw(
		workspaceId,
		"OPENROUTER_API_KEY",
	);
	if (!apiKey) {
		buildError("badRequest", {
			info: "OpenRouter API key not configured. Go to Settings to add it.",
		});
	}
	return apiKey;
}

async function resolveModel(
	workspaceId: string,
	override?: string,
): Promise<string> {
	if (override) return override;
	const model = await SettingsService.getRaw(workspaceId, MODEL_SETTING_KEY);
	return model || DEFAULT_MODEL;
}

async function callModel(
	apiKey: string,
	model: string,
	content: MessageContent,
): Promise<string> {
	const response = await fetch(OPENROUTER_URL, {
		body: JSON.stringify({
			max_tokens: MAX_TOKENS,
			messages: [{ content, role: "user" }],
			model,
			temperature: TEMPERATURE,
		}),
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		method: "POST",
	});
	if (!response.ok) {
		const errorBody = await response.text().catch(() => "Unknown error");
		log.error(
			{ errorBody: errorBody.slice(0, 300), status: response.status },
			"OpenRouter API error",
		);
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
			info: `OpenRouter API error (HTTP ${response.status})`,
		});
	}
	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	return data.choices?.[0]?.message?.content ?? "";
}

function parseAnalysis(content: string): ResearchAnalysis {
	const parsed = analysisSchema(JSON.parse(extractJson(content)));
	if (parsed instanceof type.errors) {
		buildError("storeApiError", {
			info: `AI model returned malformed analysis JSON: ${parsed.summary.slice(0, 300)}`,
		});
	}
	return parsed as ResearchAnalysis;
}

interface ChunkExtract {
	categories: Record<string, number>;
	featuresLoved: Array<{ name: string; mentions: number }>;
	featuresHated: Array<{ name: string; mentions: number }>;
	irritations: string[];
	quotes: string[];
}

export class ResearchAiService {
	static async analyzeReviews(
		workspaceId: string,
		meta: ResearchAppMeta[],
		reviews: ResearchReview[],
		options: { deep?: boolean; model?: string } = {},
	): Promise<{ analysis: ResearchAnalysis; model: string }> {
		const apiKey = await getApiKey(workspaceId);
		const model = await resolveModel(workspaceId, options.model);
		const analysis =
			options.deep && reviews.length > MAX_REVIEWS_SINGLE_PASS
				? await ResearchAiService.analyzeDeep(apiKey, model, meta, reviews)
				: await ResearchAiService.analyzeSinglePass(
						apiKey,
						model,
						meta,
						reviews,
					);
		return { analysis, model };
	}

	private static async analyzeSinglePass(
		apiKey: string,
		model: string,
		meta: ResearchAppMeta[],
		reviews: ResearchReview[],
	): Promise<ResearchAnalysis> {
		const catIds = RESEARCH_CATEGORIES.map((c) => c.id).join(", ");
		const catList = RESEARCH_CATEGORIES.map(
			(c) => `- "${c.id}": ${c.label}`,
		).join("\n");
		const prompt = `You are an ASO and mobile-app quality analyst. Analyze the reviews.

APP:
${metaBlock(meta)}

REVIEWS (${Math.min(reviews.length, MAX_REVIEWS_SINGLE_PASS)} most recent):
${reviewLines(reviews, MAX_REVIEWS_SINGLE_PASS)}

TASK — return ONLY valid JSON (no markdown) with the structure:
${ANALYSIS_JSON_SPEC(catIds)}

Categories:
${catList}

Rules: skip categories with count=0; a review can belong to multiple categories; featuresLoved/featuresHated are SPECIFIC product features (e.g. "receipt scanning", "offline mode"), not generalities; asoKeywords: 8-14 phrases.`;
		return parseAnalysis(await callModel(apiKey, model, prompt));
	}

	// Deep analysis: map-reduce over all reviews. Map extracts data from
	// ~150-review chunks; reduce synthesizes the final report from aggregates.
	private static async analyzeDeep(
		apiKey: string,
		model: string,
		meta: ResearchAppMeta[],
		reviews: ResearchReview[],
	): Promise<ResearchAnalysis> {
		const catIds = RESEARCH_CATEGORIES.map((c) => c.id).join(", ");
		const chunks: ResearchReview[][] = [];
		for (let i = 0; i < reviews.length; i += DEEP_CHUNK_SIZE) {
			chunks.push(reviews.slice(i, i + DEEP_CHUNK_SIZE));
		}

		const extracts: ChunkExtract[] = [];
		for (let i = 0; i < chunks.length; i += DEEP_PARALLEL) {
			const batch = chunks.slice(i, i + DEEP_PARALLEL);
			const results = await Promise.all(
				batch.map(async (chunk) => {
					const prompt = `Extract data from the reviews of the app "${meta[0]?.title}". Return ONLY JSON:
{
  "categories": { "<id from: ${catIds}>": <number of reviews with this problem> },
  "featuresLoved": [{ "name": "<specific feature>", "mentions": <how many times praised> }],
  "featuresHated": [{ "name": "<specific feature>", "mentions": <how many times criticized> }],
  "irritations": ["what specifically annoys users — in English, max 6 items"],
  "quotes": ["max 5 most telling short quotes (verbatim)"]
}

REVIEWS:
${reviewLines(chunk, chunk.length)}`;
					try {
						return JSON.parse(
							extractJson(await callModel(apiKey, model, prompt)),
						) as ChunkExtract;
					} catch {
						return null;
					}
				}),
			);
			extracts.push(...results.filter((r): r is ChunkExtract => r !== null));
		}
		if (!extracts.length) {
			buildError("storeApiError", {
				info: "Deep analysis failed: no chunk returned data",
			});
		}

		const catTotals: Record<string, number> = {};
		const loved: Record<string, number> = {};
		const hated: Record<string, number> = {};
		const irritations: string[] = [];
		const quotes: string[] = [];
		for (const e of extracts) {
			for (const [k, v] of Object.entries(e.categories ?? {})) {
				catTotals[k] = (catTotals[k] ?? 0) + (typeof v === "number" ? v : 0);
			}
			for (const f of e.featuresLoved ?? []) {
				loved[f.name.toLowerCase()] =
					(loved[f.name.toLowerCase()] ?? 0) + (f.mentions || 1);
			}
			for (const f of e.featuresHated ?? []) {
				hated[f.name.toLowerCase()] =
					(hated[f.name.toLowerCase()] ?? 0) + (f.mentions || 1);
			}
			irritations.push(...(e.irritations ?? []));
			quotes.push(...(e.quotes ?? []));
		}

		const byStars = { negative: 0, neutral: 0, positive: 0 };
		for (const r of reviews) {
			if (r.stars >= 4) byStars.positive++;
			else if (r.stars === 3) byStars.neutral++;
			else byStars.negative++;
		}

		const top25 = (rec: Record<string, number>) =>
			Object.fromEntries(
				Object.entries(rec)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 25),
			);

		const reducePrompt = `You are a mobile-app quality analyst. Below is the AGGREGATE from an analysis of ${reviews.length} app reviews (processed in ${extracts.length} batches).

APP:
${metaBlock(meta)}

AGGREGATE:
- actual sentiment (counted from stars): ${JSON.stringify(byStars)}
- problem totals per category: ${JSON.stringify(catTotals)}
- praised features (name: total number of mentions): ${JSON.stringify(top25(loved))}
- criticized features: ${JSON.stringify(top25(hated))}
- irritations (raw, with duplicates): ${JSON.stringify(irritations.slice(0, 60))}
- quotes: ${JSON.stringify(quotes.slice(0, 40))}

TASK — synthesize the final report. Merge duplicate features/irritations (sum different names for the same thing). Use the sentiment from the aggregate unchanged. Return ONLY JSON:
${ANALYSIS_JSON_SPEC(catIds)}`;
		return parseAnalysis(await callModel(apiKey, model, reducePrompt));
	}

	static async analyzeVisual(
		workspaceId: string,
		meta: ResearchAppMeta,
		options: { model?: string } = {},
	): Promise<{ visual: VisualAnalysis; model: string }> {
		const images = [meta.icon, ...(meta.screenshots ?? [])]
			.filter((u): u is string => Boolean(u))
			.slice(0, MAX_VISUAL_IMAGES);
		if (!images.length) {
			buildError("badRequest", {
				info: "No icon or screenshots available for visual analysis",
			});
		}
		const apiKey = await getApiKey(workspaceId);
		const model = await resolveModel(workspaceId, options.model);
		const content: MessageContent = [
			{
				text: `You are an ASO expert on store-page conversion. The first image is the ICON of the app "${meta.title}" (${meta.genre ?? ""}), the following ones are screenshots from the store page. Evaluate them in terms of install conversion. Return ONLY JSON:
{
  "iconVerdict": "icon evaluation in English: legibility at small size, distinctiveness against the category, 2-3 sentences",
  "screenshotFindings": ["evaluation of each screenshot in order: what it communicates, what to improve — in English"],
  "conversionTips": ["3-6 specific recommendations to increase store-page conversion, from the most important"]
}`,
				type: "text",
			},
			...images.map((url) => ({
				image_url: { url },
				type: "image_url" as const,
			})),
		];
		const parsed = visualSchema(
			JSON.parse(extractJson(await callModel(apiKey, model, content))),
		);
		if (parsed instanceof type.errors) {
			buildError("storeApiError", {
				info: `AI vision model returned malformed JSON: ${parsed.summary.slice(0, 200)}`,
			});
		}
		return { model, visual: parsed as VisualAnalysis };
	}

	static async compareWithCompetitor(
		workspaceId: string,
		ourMeta: ResearchAppMeta,
		ourReviews: ResearchReview[],
		compMeta: ResearchAppMeta,
		compReviews: ResearchReview[],
		options: { model?: string } = {},
	): Promise<{ comparison: CompareAnalysis; model: string }> {
		const apiKey = await getApiKey(workspaceId);
		const model = await resolveModel(workspaceId, options.model);
		const prompt = `Compare two competing mobile apps based on user reviews.

OUR APP: "${ourMeta.title}" — rating ${ourMeta.rating?.toFixed(2)}
OUR REVIEWS (${Math.min(ourReviews.length, MAX_COMPARE_REVIEWS)}):
${reviewLines(ourReviews, MAX_COMPARE_REVIEWS)}

COMPETITOR: "${compMeta.title}" (${compMeta.developer}) — rating ${compMeta.rating?.toFixed(2)}
COMPETITOR REVIEWS (${Math.min(compReviews.length, MAX_COMPARE_REVIEWS)}):
${reviewLines(compReviews, MAX_COMPARE_REVIEWS)}

Return ONLY JSON (everything in English):
{
  "verdict": "2-3 sentences: who wins and why",
  "theyDoBetter": ["what the competitor's users praise that ours complain about / is missing"],
  "weDoBetter": ["what we do better according to the reviews"],
  "featureGaps": ["specific features the competitor has and that are praised, but which do not exist or fall short in ours"]
}`;
		const parsed = compareSchema(
			JSON.parse(extractJson(await callModel(apiKey, model, prompt))),
		);
		if (parsed instanceof type.errors) {
			buildError("storeApiError", {
				info: `AI model returned malformed comparison JSON: ${parsed.summary.slice(0, 200)}`,
			});
		}
		return { comparison: parsed as CompareAnalysis, model };
	}
}

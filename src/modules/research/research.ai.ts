import { type } from "arktype";
import config from "@/config";
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
const MAX_TOKENS = 6000;

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
  "summary": "3-5 zdań po polsku: ogólny obraz — co użytkowników boli najbardziej, co chwalą, jaki trend",
  "sentiment": { "positive": <liczba recenzji 4-5★>, "neutral": <3★>, "negative": <1-2★> },
  "categories": [
    {
      "id": "<jedno z: ${catIds}>",
      "count": <ile recenzji dotyczy tej kategorii>,
      "severity": "low" | "medium" | "high",
      "insight": "1-2 zdania po polsku: co konkretnie się powtarza",
      "quotes": ["max 3 dosłowne, krótkie cytaty"]
    }
  ],
  "featuresLoved": [
    { "name": "<konkretna funkcja apki>", "mentions": <ile razy chwalona>, "insight": "co dokładnie ludzie w niej cenią (po polsku)" }
  ],
  "featuresHated": [
    { "name": "<konkretna funkcja apki>", "mentions": <ile razy krytykowana>, "insight": "co dokładnie w niej wkurza (po polsku)" }
  ],
  "topIrritations": ["5-8 rzeczy, które najbardziej denerwują użytkowników, od najczęstszej — po polsku, konkretnie"],
  "quickWins": ["3-6 konkretnych, technicznych rekomendacji po polsku, posortowane wg efekt/nakład"],
  "metadataTips": ["2-4 wskazówki ASO dot. tytułu/podtytułu/opisu apki po polsku (np. brakująca fraza w tytule, propozycja lepszego podtytułu — pamiętaj o limicie 30 znaków)"],
  "asoKeywords": [
    { "keyword": "<fraza 1-3 słowa w języku rynku apki>", "reason": "dlaczego" }
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
				`${m.store === "appstore" ? "App Store" : "Google Play"}: "${m.title}" (${m.developer}), rating ${m.rating?.toFixed(2) ?? "?"} przy ${m.ratingsCount ?? "?"} ocenach, wersja ${m.version ?? "?"}.\nOpis (fragment): ${(m.description ?? "").slice(0, 600)}`,
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
		const prompt = `Jesteś analitykiem ASO i jakości aplikacji mobilnych. Przeanalizuj recenzje.

APLIKACJA:
${metaBlock(meta)}

RECENZJE (${Math.min(reviews.length, MAX_REVIEWS_SINGLE_PASS)} najnowszych):
${reviewLines(reviews, MAX_REVIEWS_SINGLE_PASS)}

ZADANIE — zwróć WYŁĄCZNIE poprawny JSON (bez markdown) o strukturze:
${ANALYSIS_JSON_SPEC(catIds)}

Kategorie:
${catList}

Zasady: pomiń kategorie z count=0; recenzja może należeć do wielu kategorii; featuresLoved/featuresHated to KONKRETNE funkcje produktu (np. "skanowanie paragonów", "tryb offline"), nie ogólniki; asoKeywords: 8-14 fraz.`;
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
					const prompt = `Ekstrahuj dane z recenzji aplikacji "${meta[0]?.title}". Zwróć WYŁĄCZNIE JSON:
{
  "categories": { "<id z: ${catIds}>": <liczba recenzji z tym problemem> },
  "featuresLoved": [{ "name": "<konkretna funkcja>", "mentions": <ile razy chwalona> }],
  "featuresHated": [{ "name": "<konkretna funkcja>", "mentions": <ile razy krytykowana> }],
  "irritations": ["co konkretnie denerwuje użytkowników — po polsku, max 6 pozycji"],
  "quotes": ["max 5 najbardziej wymownych krótkich cytatów (dosłownych)"]
}

RECENZJE:
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

		const reducePrompt = `Jesteś analitykiem jakości aplikacji mobilnych. Poniżej AGREGAT z analizy ${reviews.length} recenzji apki (przetworzonych w ${extracts.length} partiach).

APLIKACJA:
${metaBlock(meta)}

AGREGAT:
- rzeczywisty sentiment (policzony ze gwiazdek): ${JSON.stringify(byStars)}
- sumy problemów per kategoria: ${JSON.stringify(catTotals)}
- chwalone funkcje (nazwa: łączna liczba wzmianek): ${JSON.stringify(top25(loved))}
- krytykowane funkcje: ${JSON.stringify(top25(hated))}
- irytacje (surowe, z duplikatami): ${JSON.stringify(irritations.slice(0, 60))}
- cytaty: ${JSON.stringify(quotes.slice(0, 40))}

ZADANIE — zsyntetyzuj finalny raport. Scal duplikaty funkcji/irytacji (różne nazwy tej samej rzeczy zsumuj). Użyj sentimentu z agregatu bez zmian. Zwróć WYŁĄCZNIE JSON:
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
				text: `Jesteś ekspertem ASO od konwersji strony sklepu. Pierwszy obraz to IKONA aplikacji "${meta.title}" (${meta.genre ?? ""}), kolejne to screenshoty ze strony sklepu. Oceń je pod kątem konwersji instalacji. Zwróć WYŁĄCZNIE JSON:
{
  "iconVerdict": "ocena ikony po polsku: czytelność w małym rozmiarze, wyróżnialność na tle kategorii, 2-3 zdania",
  "screenshotFindings": ["ocena każdego screenshota po kolei: co komunikuje, co poprawić — po polsku"],
  "conversionTips": ["3-6 konkretnych rekomendacji zwiększających konwersję strony sklepu, od najważniejszej"]
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
		const prompt = `Porównaj dwie konkurencyjne aplikacje mobilne na podstawie recenzji użytkowników.

NASZA APKA: "${ourMeta.title}" — rating ${ourMeta.rating?.toFixed(2)}
RECENZJE NASZEJ (${Math.min(ourReviews.length, MAX_COMPARE_REVIEWS)}):
${reviewLines(ourReviews, MAX_COMPARE_REVIEWS)}

KONKURENT: "${compMeta.title}" (${compMeta.developer}) — rating ${compMeta.rating?.toFixed(2)}
RECENZJE KONKURENTA (${Math.min(compReviews.length, MAX_COMPARE_REVIEWS)}):
${reviewLines(compReviews, MAX_COMPARE_REVIEWS)}

Zwróć WYŁĄCZNIE JSON (wszystko po polsku):
{
  "verdict": "2-3 zdania: kto wygrywa i dlaczego",
  "theyDoBetter": ["co użytkownicy konkurenta chwalą, a nasi na to narzekają / tego brakuje"],
  "weDoBetter": ["co my robimy lepiej wg recenzji"],
  "featureGaps": ["konkretne funkcje, które konkurent ma i są chwalone, a u nas nie istnieją lub kuleją"]
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

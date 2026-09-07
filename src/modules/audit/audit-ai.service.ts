import { type } from "arktype";
import { AIService } from "@/modules/ai/ai.service";
import type { AuditApp } from "@/modules/research/listing-audit";
import { createLogger } from "@/utils/logger";
import type { AppAuditReport, AuditAiInsights } from "./audit.types";

const log = createLogger("audit-ai");

/** Store limits the rewrites must respect, whatever the model returns. */
const TITLE_LIMIT = 30;
const SUBTITLE_LIMIT = 30;
const KEYWORDS_LIMIT = 100;
const OPENING_LIMIT = 300;
const MAX_PRIORITIES = 4;
/** Keywords handed to the model: enough for judgement, not the whole table. */
const MAX_KEYWORDS_IN_PROMPT = 18;
const MAX_DESCRIPTION_CHARS = 1800;
const TEMPERATURE = 0.3;

const insightsSchema = type({
	priorities: type({ how: "string", title: "string", why: "string" }).array(),
	rewrites: {
		keywords: "string | null",
		opening: "string | null",
		subtitle: "string | null",
		title: "string | null",
	},
	summary: "string",
});

const SYSTEM_PROMPT = `You are a senior App Store Optimization strategist reviewing one app listing for its developer.

You receive: the listing text as the store serves it, the market and language, a rules-based audit (score, issues, strengths) and a table of keywords with popularity (1-100, higher = more searches), difficulty (1-100, lower = easier to rank), the app's current rank for each, and whether the keyword is safe to recommend (from the app's own category).

Your job is judgement, not repetition: connect the numbers, decide what matters most, and say it plainly.

Rules:
- Recommend only keywords marked recommendable. Never invent keywords, features, numbers, awards or claims that are not in the listing or the table.
- Keep the brand name exactly as written.
- Write everything in the listing's language.
- No emoji, no typographic dashes or smart quotes: plain hyphens and straight quotes only. The stores reject emoji and the text is pasted as-is.
- Rewrites must fit the store limits: title and subtitle at most ${TITLE_LIMIT} characters each, keywords at most ${KEYWORDS_LIMIT} characters (comma-separated, no spaces after commas, no word repeated from the title or subtitle), opening at most ${OPENING_LIMIT} characters (the first two or three lines of the description, benefit first).
- Return null for a rewrite when the current text is already the best move; do not rewrite for the sake of it.
- Priorities: at most ${MAX_PRIORITIES}, ordered by expected impact on installs, each concrete (which field, which word, why the numbers support it). Skip anything the developer cannot act on.

Return ONLY a JSON object with this exact shape and nothing else:
{
  "summary": "two or three sentences, plain language, the single biggest lever first",
  "priorities": [{ "title": "short imperative", "why": "the numbers behind it", "how": "the exact change to make" }],
  "rewrites": { "title": string | null, "subtitle": string | null, "keywords": string | null, "opening": string | null }
}`;

function cut(value: string | null, limit: number): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.length > limit ? null : trimmed;
}

function stripFences(raw: string): string {
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const body = (fenced ? fenced[1] : raw).trim();
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

function buildUserPrompt(report: AppAuditReport, listing: AuditApp): string {
	const keywords = report.keywords
		.filter((k) => !k.error)
		.slice(0, MAX_KEYWORDS_IN_PROMPT)
		.map((k) => {
			const safe = report.recommendable.some(
				(r) => r.trim().toLowerCase() === k.keyword.trim().toLowerCase(),
			);
			return `- "${k.keyword}": popularity ${k.popularity}, difficulty ${k.difficulty}, rank ${k.appRank ?? "none"}, ${safe ? "recommendable" : "other category - do not recommend"}`;
		});
	const issues = report.store.issues.map(
		(i) => `- [${i.severity}] ${i.title}: ${i.detail}`,
	);
	const strengths = report.store.strengths.map((s) => `- ${s}`);
	const description = listing.description.slice(0, MAX_DESCRIPTION_CHARS);

	return [
		`Market: ${report.country.toUpperCase()}. Listing language: ${report.language}.`,
		`Store: ${report.keywordsSupported ? "App Store" : "Google Play (no keyword difficulty data for this store - judge the text and screenshots)"}.`,
		"",
		`Title: ${listing.name}`,
		`Subtitle: ${listing.subtitle ?? "(none)"}`,
		`Category: ${listing.genre || "(unknown)"}`,
		`Rating: ${listing.rating ?? "n/a"} from ${listing.ratingsCount ?? 0} ratings. Screenshots: ${listing.screenshots}.`,
		"",
		"Description (opening first):",
		description || "(empty)",
		"",
		`Rules-based score: ${report.store.asoScore}/100.`,
		issues.length ? `Issues:\n${issues.join("\n")}` : "Issues: none.",
		strengths.length ? `Strengths:\n${strengths.join("\n")}` : "",
		"",
		keywords.length
			? `Keywords:\n${keywords.join("\n")}`
			: "Keywords: not scored for this store.",
	]
		.filter((line) => line !== "")
		.join("\n");
}

/**
 * The model's reading of the audit. Runs only when the workspace has a key,
 * uses the model chosen for research in Settings, and never blocks the
 * report: a failure logs and returns null.
 */
export class AuditAiService {
	static async analyze(
		workspaceId: string,
		report: AppAuditReport,
		listing: AuditApp,
	): Promise<AuditAiInsights | null> {
		if (!(await AIService.resolveApiKey(workspaceId))) return null;

		const { content, model } = await AIService.complete(
			workspaceId,
			SYSTEM_PROMPT,
			buildUserPrompt(report, listing),
			{ purpose: "research", temperature: TEMPERATURE },
		);

		let parsed: unknown;
		try {
			parsed = JSON.parse(stripFences(content));
		} catch (err) {
			log.warn({ err, model }, "Audit AI returned non-JSON content");
			return null;
		}
		const validated = insightsSchema(parsed);
		if (validated instanceof type.errors) {
			log.warn({ model, summary: validated.summary }, "Audit AI JSON rejected");
			return null;
		}

		return {
			generatedAt: new Date().toISOString(),
			language: report.language,
			model,
			priorities: validated.priorities.slice(0, MAX_PRIORITIES),
			rewrites: {
				keywords: cut(validated.rewrites.keywords, KEYWORDS_LIMIT),
				opening: cut(validated.rewrites.opening, OPENING_LIMIT),
				subtitle: cut(validated.rewrites.subtitle, SUBTITLE_LIMIT),
				title: cut(validated.rewrites.title, TITLE_LIMIT),
			},
			summary: validated.summary.trim(),
		};
	}
}

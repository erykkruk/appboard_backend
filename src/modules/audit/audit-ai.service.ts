import { type } from "arktype";
import { AIService } from "@/modules/ai/ai.service";
import type { AuditApp } from "@/modules/research/listing-audit";
import { createLogger } from "@/utils/logger";
import type { AppAuditReport, AuditAiInsights } from "./audit.types";

const log = createLogger("audit-ai");

/** Store limits the rewrites must respect, whatever the model returns. */
const TITLE_LIMIT = 30;
const SUBTITLE_LIMIT = 30;
/** Google Play has no subtitle: its slot in the rewrites is the short description. */
const SHORT_DESCRIPTION_LIMIT = 80;
const KEYWORDS_LIMIT = 100;
const OPENING_LIMIT = 300;
const MAX_PRIORITIES = 4;
/** Keywords handed to the model: enough for judgement, not the whole table. */
const MAX_KEYWORDS_IN_PROMPT = 18;
const MAX_DESCRIPTION_CHARS = 1800;
const TEMPERATURE = 0.3;
/** Below this many ratings a keyword above medium difficulty is not winnable. */
const SMALL_APP_RATINGS = 1000;
const SMALL_APP_MAX_DIFFICULTY = 50;

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

type Store = "appstore" | "play";

const STORE_RULES: Record<Store, string> = {
	appstore: `Store facts (App Store):
- Search indexes the title, the subtitle and the keyword field only; the description and promotional text are not indexed. Every word counts once across those three fields, so a word already in the title or subtitle is wasted in the keyword field.
- Keyword field: at most ${KEYWORDS_LIMIT} characters, comma-separated, no spaces after commas, singular forms, no plurals of a word already present, no stop words, no brand names other than this app's own.
- Apple 2.3.10: no other platforms (Android, Google Play, PC), no prices or "free", no ranking claims ("#1", "best") in the title or subtitle.`,
	play: `Store facts (Google Play):
- There is no keyword field: search reads the title, the short description and the full description. The "subtitle" slot below is the short description (at most ${SHORT_DESCRIPTION_LIMIT} characters), the one line shown under the title on the listing page.
- Return null for "keywords": this store has none.
- Google Play metadata policy: no ranking or promotional words in the title ("#1", "best", "free", "sale"), no ALL CAPS words that are not the brand, no emoji, no keyword lists in the description, no anonymous user testimonials.`,
};

function buildSystemPrompt(store: Store): string {
	return `You are a senior App Store Optimization strategist reviewing one app listing for its developer.

You receive: the listing text as the store serves it, the market and language, a rules-based audit (score, issues, strengths) and, for the App Store, a table of keywords with popularity (1-100, higher = more searches), difficulty (1-100, lower = easier to rank), the app's current rank for each ("none" = not in the top 200), and whether the keyword is safe to recommend (from the app's own category).

Your job is judgement, not repetition: connect the numbers, decide what matters most, and say it plainly.

${STORE_RULES[store]}

Winnability: an app with fewer than ${SMALL_APP_RATINGS} ratings should chase keywords with difficulty well below ${SMALL_APP_MAX_DIFFICULTY} and real popularity; a term the app already ranks in the top 10 for is a strength to keep, not a lever; a high-popularity term with difficulty above the app's weight class is a distraction, say so instead of recommending it.

Rules:
- Recommend only keywords marked recommendable. Never invent keywords, features, numbers, awards or claims that are not in the listing or the table.
- Keep the brand name exactly as written.
- No competitor or third-party names anywhere in a rewrite, no "alternative to" phrasing: both stores reject it.
- You cannot see the screenshots or the icon; you only know how many screenshots there are. Do not judge their content.
- Language: write the summary and the priorities in English (the developer reads them in the panel). Write every rewrite in the listing's language, exactly as it will be pasted into the store.
- No emoji, no typographic dashes or smart quotes: plain hyphens and straight quotes only. The stores reject emoji and the text is pasted as-is.
- Rewrites must fit the store limits: title at most ${TITLE_LIMIT} characters, "subtitle" at most ${store === "play" ? SHORT_DESCRIPTION_LIMIT : SUBTITLE_LIMIT} characters, opening at most ${OPENING_LIMIT} characters (the first two or three lines of the description, benefit first, in plain sentences).
- Return null for a rewrite when the current text is already the best move; do not rewrite for the sake of it.
- Priorities: at most ${MAX_PRIORITIES}, ordered by expected impact on installs, each concrete (which field, which word, why the numbers support it). Skip anything the developer cannot act on.

Return ONLY a JSON object with this exact shape and nothing else:
{
  "summary": "two or three sentences, plain language, the single biggest lever first",
  "priorities": [{ "title": "short imperative", "why": "the numbers behind it", "how": "the exact change to make" }],
  "rewrites": { "title": string | null, "subtitle": string | null, "keywords": string | null, "opening": string | null }
}`;
}

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

function storeOf(report: AppAuditReport): Store {
	return report.keywordsSupported === false ? "play" : "appstore";
}

function buildUserPrompt(report: AppAuditReport, listing: AuditApp): string {
	const store = storeOf(report);
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
		`Store: ${store === "play" ? "Google Play" : "App Store"}.`,
		"",
		`Title: ${listing.name}`,
		`${store === "play" ? "Short description" : "Subtitle"}: ${listing.subtitle ?? "(none)"}`,
		`Category: ${listing.genre || "(unknown)"}`,
		`Rating: ${listing.rating ?? "n/a"} from ${listing.ratingsCount ?? 0} ratings. Screenshot count: ${listing.screenshots} (content not available to you).`,
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
			: store === "play"
				? "Keywords: not measured on Google Play; judge the text against the store facts."
				: "Keywords: none scored yet.",
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

		const store = storeOf(report);
		const { content, model } = await AIService.complete(
			workspaceId,
			buildSystemPrompt(store),
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

		const subtitleLimit =
			store === "play" ? SHORT_DESCRIPTION_LIMIT : SUBTITLE_LIMIT;
		return {
			generatedAt: new Date().toISOString(),
			language: report.language,
			model,
			priorities: validated.priorities.slice(0, MAX_PRIORITIES),
			rewrites: {
				// Google Play has no keyword field: whatever the model returns
				// there has nowhere to be pasted.
				keywords:
					store === "play"
						? null
						: cut(validated.rewrites.keywords, KEYWORDS_LIMIT),
				opening: cut(validated.rewrites.opening, OPENING_LIMIT),
				subtitle: cut(validated.rewrites.subtitle, subtitleLimit),
				title: cut(validated.rewrites.title, TITLE_LIMIT),
			},
			summary: validated.summary.trim(),
		};
	}
}

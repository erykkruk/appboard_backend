/**
 * Concrete, accept-or-reject text proposals derived from an audit.
 *
 * Pure and browser-safe like the audit itself: only type imports, so the
 * panel can copy it verbatim. Every proposal is deterministic math over the
 * scored keywords - no AI needed to say "put your best winnable term in the
 * title". The user sees each one as a diff and nothing changes until they
 * accept it.
 */
import type { AuditIssue } from "./listing-audit";
import type { KeywordScore } from "./scoring-types";

export type SuggestionField = "title" | "shortDesc" | "keywords";

export interface SuggestionInput {
	platform: "ios" | "android";
	language: string;
	name: string;
	/** iOS subtitle / Google Play short description. */
	shortDesc?: string;
	/** iOS keyword field. */
	keywords?: string;
	description?: string;
}

export interface Suggestion {
	id: string;
	field: SuggestionField;
	language: string;
	current: string;
	proposed: string;
	/** One sentence a person can act on, in the audit's voice. */
	reason: string;
	/** Points the related audit rule is worth; 0 for a pure improvement. */
	points: number;
	keyword?: string;
}

const LIMITS = {
	android: { shortDesc: 80, title: 50 },
	ios: { keywords: 100, shortDesc: 30, title: 30 },
} as const;

const TITLE_ISSUES = new Set([
	"title-keywords",
	"title-unwinnable",
	"title-upgrade",
]);

/** Small on purpose: a proposal must be a term worth having, not filler. */
const MIN_POPULARITY = 20;
const MAX_KEYWORD_DIFFICULTY = 45;

function brandOf(name: string): string {
	const head = name.split(/[:–—|-]/)[0] ?? name;
	return head.trim();
}

function titleCase(phrase: string): string {
	return phrase
		.split(" ")
		.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
		.join(" ");
}

function contains(haystack: string, needle: string): boolean {
	return haystack.toLowerCase().includes(needle.toLowerCase());
}

function words(text: string): Set<string> {
	return new Set(
		(text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).filter(
			(w) => w.length > 1,
		),
	);
}

/**
 * Winnable, recommendable terms ordered by opportunity, brand excluded. This
 * is the only pool proposals draw from, so a cross-category term that merely
 * scored well can never end up in someone's title.
 */
function candidatePool(
	scores: KeywordScore[],
	recommendable: string[],
	brand: string,
): KeywordScore[] {
	const allowed = new Set(recommendable.map((k) => k.trim().toLowerCase()));
	const brandLower = brand.toLowerCase();
	return scores
		.filter((s) => !s.error && allowed.has(s.keyword.trim().toLowerCase()))
		.filter((s) => !s.keyword.toLowerCase().includes(brandLower))
		.filter(
			(s) =>
				(s.popularity ?? 0) >= MIN_POPULARITY &&
				(s.difficulty <= MAX_KEYWORD_DIFFICULTY ||
					(s.appRank != null && s.appRank <= 50)),
		)
		.sort((a, b) => b.opportunity - a.opportunity);
}

export function buildSuggestions(
	input: SuggestionInput,
	scores: KeywordScore[],
	recommendable: string[],
	issues: AuditIssue[],
): Suggestion[] {
	const out: Suggestion[] = [];
	const limits = LIMITS[input.platform];
	const brand = brandOf(input.name);
	const pool = candidatePool(scores, recommendable, brand);
	if (pool.length === 0) return out;

	// ── Title ────────────────────────────────────────────────────────
	const titleIssue = issues.find((i) => TITLE_ISSUES.has(i.id));
	let titleAfter = input.name;
	if (titleIssue) {
		const pick = pool.find((s) => {
			const candidate = `${brand}: ${titleCase(s.keyword)}`;
			return (
				!contains(input.name, s.keyword) && candidate.length <= limits.title
			);
		});
		if (pick) {
			titleAfter = `${brand}: ${titleCase(pick.keyword)}`;
			out.push({
				current: input.name,
				field: "title",
				id: `title-${input.language}`,
				keyword: pick.keyword,
				language: input.language,
				points: titleIssue.scorePenalty,
				proposed: titleAfter,
				reason: `The title is the strongest ranking field. "${pick.keyword}" is searched (popularity ${pick.popularity ?? 0}) at a difficulty you can win (${pick.difficulty}), and it is not in your title yet. ${titleAfter.length} of ${limits.title} characters.`,
			});
		}
	}

	// ── Subtitle (iOS) / short description (Android) ─────────────────
	const shortCurrent = input.shortDesc ?? "";
	const shortHasKeyword = pool.some((s) => contains(shortCurrent, s.keyword));
	if (!shortHasKeyword) {
		const unusedInTitle = pool.filter((s) => !contains(titleAfter, s.keyword));
		const first = unusedInTitle[0];
		if (first) {
			let proposed = titleCase(first.keyword);
			const second = unusedInTitle.find(
				(s) =>
					s !== first &&
					!contains(proposed, s.keyword) &&
					`${proposed} & ${titleCase(s.keyword)}`.length <= limits.shortDesc,
			);
			if (second) proposed = `${proposed} & ${titleCase(second.keyword)}`;
			if (proposed.length <= limits.shortDesc && proposed !== shortCurrent) {
				out.push({
					current: shortCurrent,
					field: "shortDesc",
					id: `shortDesc-${input.language}`,
					keyword: first.keyword,
					language: input.language,
					points: 6,
					proposed,
					reason:
						input.platform === "ios"
							? `The subtitle is indexed like the title and yours ${shortCurrent ? "carries none of your winnable terms" : "is empty"}. Apple does not expose the live subtitle publicly, so this is your draft - ${proposed.length} of ${limits.shortDesc} characters.`
							: `The short description is the first thing people read on Google Play and it carries none of your winnable terms. ${proposed.length} of ${limits.shortDesc} characters.`,
				});
			}
		}
	}

	// ── Keyword field (iOS only) ─────────────────────────────────────
	if (input.platform === "ios" && "keywords" in limits) {
		const shortAfter =
			out.find((s) => s.field === "shortDesc")?.proposed ?? shortCurrent;
		const taken = new Set([...words(titleAfter), ...words(shortAfter)]);
		const parts: string[] = [];
		let length = 0;
		for (const s of pool) {
			// Apple indexes each word once across title, subtitle and this
			// field, so a word already in the title only wastes characters here.
			for (const w of s.keyword.toLowerCase().split(" ")) {
				if (taken.has(w) || w.length < 2) continue;
				const next = length + w.length + (parts.length ? 1 : 0);
				if (next > limits.keywords) continue;
				parts.push(w);
				taken.add(w);
				length = next;
			}
		}
		const proposed = parts.join(",");
		const current = input.keywords ?? "";
		if (parts.length > 0 && proposed !== current) {
			out.push({
				current,
				field: "keywords",
				id: `keywords-${input.language}`,
				language: input.language,
				points: 8,
				proposed,
				reason: `Comma-separated, no spaces, no word repeated from the title or subtitle - each word counts once. ${proposed.length} of ${limits.keywords} characters used${current ? "" : ", and the field is empty today"}.`,
			});
		}
	}

	return out;
}

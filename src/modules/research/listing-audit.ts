/**
 * Rules-based listing audit and keyword-candidate extraction.
 *
 * Browser-safe by contract: this file has ZERO runtime imports (only
 * type-only ones from scoring-types), so the panel copies it verbatim via
 * scripts/sync-aso-engine.sh and runs it in the visitor's browser for the
 * free ASO check-up, while the backend runs the same code for connected
 * apps. One implementation, two callers - never two copies of the rules.
 */
import type { KeywordScore } from "./scoring-types";

export const MAX_CANDIDATES = 14;
/**
 * Keeps only rivals from your own category. Search results mix categories - a
 * Polish query for "telewizor" returns screen-mirroring utilities next to TV
 * games - and their vocabulary is not yours.
 */
export function inGenre(ownGenre: string) {
	const mine = ownGenre.split(",")[0]?.trim().toLowerCase();
	return (competitor: { genre?: string }): boolean => {
		if (!mine) return true;
		const theirs = (competitor.genre ?? "").split(",")[0]?.trim().toLowerCase();
		return !theirs || theirs === mine;
	};
}

/**
 * Words that are frequent in store copy but worthless as search terms.
 * Without the second block a real listing yields candidates like "into",
 * "nobody" and "anything", which then get scored and surface as fake
 * "hidden gems" - the estimator reads weak competitors as low difficulty.
 */
const STOPWORDS = new Set(
	(
		"a an the and or of for to in on with your you our my is are be it this that " +
		"app apps free best new get more all now most every from by at as can will " +
		// Polish: pronouns, conjunctions, particles and generic verbs. Without
		// these a Polish listing yields "nie", "nikt", "albo" as keywords, and
		// the title rule then claims the app targets the word "not".
		"nie tak nic nikt kto co cos ktos ktory ktora ktore gdy gdzie kiedy jak " +
		"juz tez tylko bardzo moze mozesz mozna ma maja mam masz jest sa byc bylo " +
		"albo lub oraz ale wiec czy ten ta to te tego tej tym tych taki taka takie " +
		"swoj swoja swoje twoj twoja twoje nasz nasza nasze wasz kazdy kazda kazde " +
		"wszyscy wszystko wszystkie po za przez pod nad przed bez przy oraz raz " +
		"sie sobie siebie jego jej ich im nam wam mnie ciebie tobie " +
		"i o w z na do dla aplikacja aplikacje uzytkownik uzytkownicy " +
		// German / French / Spanish fillers, same reasoning.
		"der die das und oder fur mit dein deine ist app fuer den dem eine einen " +
		"nicht auch nur schon sehr mehr alle jeder man sich " +
		"les des une un et ou pour avec votre vous nous plus tout tous " +
		"que qui pas sur dans par ses est sont " +
		"los las una unos unas para con por como mas todo todos muy " +
		// Narrative filler: pronouns, connectives, generic verbs and nouns that
		// carry no search intent on their own.
		"into onto out off over under about after before while when where who whom " +
		"nobody anybody somebody everyone anyone someone nothing anything something " +
		"everything they them their there here then than what which whose why how " +
		"just also even only still yet much many some any other another same " +
		"make makes made making take takes taken taking give gives given keep keeps " +
		"goes going went come comes coming turn turns turned run runs running " +
		"open opens opened use uses used using want wants need needs let lets " +
		"one two three four five six seven eight nine ten first second next last " +
		"way ways thing things people person time times day days minute minutes " +
		"real really very quite pretty little big small good great nice " +
		"everybody nobodys installs account browser type types"
	).split(/\s+/),
);

function tokenize(text: string): string[] {
	return (
		text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []
	).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** The leading brand token of a store title ("Buzzin: TV Party" -> "buzzin"). */
export function brandToken(name: string): string {
	const head = name.split(/[:–—|-]/)[0] ?? name;
	return (head.trim().split(/\s+/)[0] ?? "").toLowerCase();
}

/**
 * A keyword is a brand match when it is (or contains) your own app name.
 * Ranking #1 for it proves nothing about discovery: the store just matched
 * your name back to you. A normal phrase that happens to sit in your title
 * ("habit tracker") is NOT this - people search it without knowing you, so
 * ranking for it is real reach and must keep counting.
 */
export function isBrandKeyword(keyword: string, name: string): boolean {
	const kw = keyword.trim().toLowerCase();
	if (!kw) return false;
	const brand = brandToken(name);
	return !!brand && (kw === brand || kw.includes(brand));
}

export interface AuditApp {
	name: string;
	description: string;
	genre: string;
	screenshots: number;
	rating?: number;
	ratingsCount?: number;
	updated?: string;
	country: string;
	/** Listing languages the app actually ships, e.g. ["en-US", "pl"]. */
	languages?: string[];
	subtitle?: string;
}

/**
 * Candidate keywords from the listing itself: cleaned title phrases first
 * (strongest signal of what the developer targets), then the most frequent
 * meaningful bigrams and unigrams from the description, then the genre.
 */
export function extractKeywordCandidates(app: AuditApp): string[] {
	const candidates: string[] = [];
	const seen = new Set<string>();
	const brand = brandToken(app.name);
	const push = (phrase: string) => {
		const norm = phrase.trim().toLowerCase();
		if (norm.length < 3 || seen.has(norm)) return;
		// The brand alone is not a discovery keyword - you already own it.
		if (brand && norm === brand) return;
		seen.add(norm);
		candidates.push(norm);
	};

	const titleParts = app.name.split(/[:–—|-]+/).slice(1);
	for (const part of titleParts) {
		for (const chunk of part.split(/[,&+/]+/)) {
			const words = tokenize(chunk);
			if (words.length >= 1 && words.length <= 3) push(words.join(" "));
		}
	}

	const words = tokenize(app.description).slice(0, 600);
	const bigrams = new Map<string, number>();
	const unigrams = new Map<string, number>();
	for (let i = 0; i < words.length; i++) {
		unigrams.set(words[i], (unigrams.get(words[i]) ?? 0) + 1);
		if (i + 1 < words.length) {
			const bg = `${words[i]} ${words[i + 1]}`;
			bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
		}
	}
	const topBigrams = [...bigrams.entries()]
		.filter(([, count]) => count >= 2)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10);
	for (const [phrase] of topBigrams) push(phrase);
	const topUnigrams = [...unigrams.entries()]
		.filter(([, count]) => count >= 3)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 6);
	for (const [word] of topUnigrams) push(word);

	if (app.genre) push(tokenize(app.genre).join(" "));

	return candidates.slice(0, MAX_CANDIDATES);
}

/**
 * Category vocabulary taken from the apps you actually compete with.
 *
 * Candidates pulled from your own listing can only ever return words you
 * already wrote - so the audit could never tell an app to add "trivia" if
 * the developer never typed it. Competitor titles are the honest source of
 * what the category is called, and they arrive free with the scoring pass.
 */
export function extractCompetitorCandidates(
	competitors: { title: string; genre?: string }[],
	ownName: string,
	exclude: string[] = [],
	/**
	 * Your own primary genre. Search results mix categories - a Polish query
	 * for "telewizor" returns screen-mirroring utilities next to TV games - and
	 * mining their titles would tell a party game to target "screen mirroring".
	 * Only same-genre rivals define your category's vocabulary.
	 */
	ownGenre?: string,
): string[] {
	const brand = brandToken(ownName);
	const taken = new Set(exclude.map((k) => k.trim().toLowerCase()));
	const counts = new Map<string, number>();
	const pool = ownGenre ? competitors.filter(inGenre(ownGenre)) : competitors;
	const bump = (phrase: string) => {
		if (phrase.length < 3 || taken.has(phrase)) return;
		if (brand && phrase.includes(brand)) return;
		counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
	};

	for (const competitor of pool) {
		// Everything before the first separator is that app's brand, which is
		// worthless to us; the descriptive tail is what names the category.
		const parts = competitor.title.split(/[:–—|-]+/);
		const tail = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
		const words = tokenize(tail ?? "");
		for (let i = 0; i < words.length; i++) {
			bump(words[i]);
			if (i + 1 < words.length) bump(`${words[i]} ${words[i + 1]}`);
		}
	}

	// A two-word phrase repeating across two rival titles is already a
	// category name; a bare single word needs to be everywhere before it
	// means anything.
	const MIN_PHRASE_HITS = 2;
	const MIN_WORD_HITS = 3;
	return [...counts.entries()]
		.filter(([phrase, count]) =>
			phrase.includes(" ") ? count >= MIN_PHRASE_HITS : count >= MIN_WORD_HITS,
		)
		.sort((a, b) => b[1] - a[1])
		.map(([phrase]) => phrase)
		.slice(0, MAX_CANDIDATES);
}

export interface AuditIssue {
	id: string;
	severity: "high" | "medium" | "low";
	title: string;
	detail: string;
	scorePenalty: number;
	/** How AppBoard makes this fix easy - shown as a hint under the issue. */
	appboard?: string;
	/** False when the issue is context we cannot act on inside the panel. */
	actionable: boolean;
}

/** Issue id -> the AppBoard capability that makes the fix easy. */
export const APPBOARD_FIXES: Record<string, string> = {
	"brand-only-ranks":
		"AppBoard finds the terms your competitors rank for and scores each one before you commit.",
	"category-mismatch":
		"AppBoard shows which category your real rivals use, and changes yours in the draft for the next release.",
	"description-opening":
		"AppBoard's AI writes benefit-first descriptions in every language you ship.",
	"description-short":
		"Generate a keyword-rich description with AppBoard AI and publish it in one click.",
	"few-ratings":
		"AppBoard tracks new reviews and drafts replies with AI, so ratings momentum builds faster.",
	"low-rating":
		"AppBoard's review analysis pinpoints the #1 complaint to fix first, with real quotes.",
	"missing-winnable-terms":
		"AppBoard scores every candidate term, then rewrites the subtitle and keyword field against the ones you can win.",
	"no-local-listing":
		"AppBoard translates your whole listing and publishes every language in one go.",
	"no-ranks":
		"Track these keywords in AppBoard - nightly re-checks show which changes move the needle.",
	"ranks-below-fold":
		"AppBoard tracks each keyword nightly, so you see whether an edit actually moved you up.",
	screenshots:
		"Design store-ready screenshots in AppBoard's free Screenshot Editor (no account needed).",
	"stale-update": "Manage versions and publish updates straight from AppBoard.",
	"title-keywords":
		"Edit the title in AppBoard and publish it to the store in one click.",
	"title-unwinnable":
		"AppBoard scores every candidate term before you commit, so you can see which one you can actually win.",
	"title-upgrade":
		"Compare both terms side by side in AppBoard, then rewrite the title against the winner.",
};

export interface AuditResult {
	asoScore: number;
	issues: AuditIssue[];
	strengths: string[];
	themes: string[];
}

const BASE_SCORE = 100;
const TITLE_LIMIT_HINT = 30;
const GOOD_SCREENSHOT_COUNT = 6;
const OLD_UPDATE_DAYS = 180;
/** Below this, an estimated popularity is too thin to build a title on. */
const MIN_TITLE_KEYWORD_POPULARITY = 20;
/** How much more popular a term must be before we call the title upgradable. */
const TITLE_UPGRADE_MARGIN = 15;
/**
 * A title term only counts when you can actually win it. Generic unigrams
 * ("game", "photo", "music") score high popularity precisely because their
 * competitors are huge - putting one in your title buys nothing.
 */
const MAX_WINNABLE_DIFFICULTY = 45;
/** Ranking this high proves the term works for you whatever its difficulty. */
const PROVEN_RANK = 50;
/** Search taps collapse past the first screen of results. */
const VISIBLE_RANK = 10;
/** Category check: how many rivals to sample, and how sure to be. */
const CATEGORY_RIVALS_PER_TERM = 10;
const CATEGORY_MIN_RIVALS = 8;
const CATEGORY_MAJORITY = 0.6;
/** A term worth chasing: enough searches to matter, low enough to win. */
const GAP_MIN_POPULARITY = 35;
const GAP_MAX_DIFFICULTY = 45;

/** Popularity is null when the estimator could not score a term at all. */
function pop(score: KeywordScore): number {
	return score.popularity ?? 0;
}

/**
 * Store country -> the language a listing needs to feel local. English
 * markets are omitted: a listing in English already serves them.
 */
const MARKET_LANGUAGE: Record<string, string> = {
	ae: "ar",
	at: "de",
	be: "nl",
	br: "pt",
	ch: "de",
	cl: "es",
	cn: "zh",
	co: "es",
	cz: "cs",
	de: "de",
	dk: "da",
	es: "es",
	fi: "fi",
	fr: "fr",
	gr: "el",
	hu: "hu",
	id: "id",
	il: "he",
	it: "it",
	jp: "ja",
	kr: "ko",
	mx: "es",
	nl: "nl",
	no: "nb",
	pl: "pl",
	pt: "pt",
	ro: "ro",
	ru: "ru",
	sa: "ar",
	se: "sv",
	th: "th",
	tr: "tr",
	tw: "zh",
	ua: "uk",
	vn: "vi",
};

function hasLanguage(languages: string[], want: string): boolean {
	return languages.some((l) => l.toLowerCase().split(/[-_]/)[0] === want);
}

export interface AuditOptions {
	/**
	 * Terms the audit is allowed to RECOMMEND. Everything scored still counts
	 * for measuring where you rank, but advice must not send a party game after
	 * "screen mirroring" just because that phrase shows up in the same search
	 * results. Omit to allow every scored term.
	 */
	recommendable?: string[];
}

/** Rules-based listing audit; the ASO score is BASE minus penalties. */
export function buildAudit(
	app: AuditApp,
	scores: KeywordScore[],
	options: AuditOptions = {},
): AuditResult {
	const issues: AuditIssue[] = [];
	const strengths: string[] = [];
	const titleLower = app.name.toLowerCase();

	const scored = scores.filter((s) => !s.error);
	// Your own name proves nothing about discovery, so every "are you
	// findable" rule below runs on the earned set only.
	const earned = scored.filter((s) => !isBrandKeyword(s.keyword, app.name));
	const allowed = options.recommendable
		? new Set(options.recommendable.map((k) => k.trim().toLowerCase()))
		: null;
	const canRecommend = (s: KeywordScore) =>
		!allowed || allowed.has(s.keyword.trim().toLowerCase());
	const suggestable = earned.filter(canRecommend);
	const bestTargets = suggestable
		.filter((s) =>
			["sweet-spot", "good-target", "hidden-gem"].includes(s.classification),
		)
		.sort((a, b) => b.opportunity - a.opportunity);

	// Title keyword usage - the strongest ranking field. A term only counts
	// when it carries real search volume; matching your own brand back does not.
	const inTitle = scored.filter(
		(s) =>
			titleLower.includes(s.keyword.toLowerCase()) &&
			s.keyword.toLowerCase() !== brandToken(app.name),
	);
	const isWinnable = (s: KeywordScore) =>
		s.difficulty <= MAX_WINNABLE_DIFFICULTY ||
		(s.appRank != null && s.appRank <= PROVEN_RANK);
	const titleKeyword = inTitle
		.filter((s) => pop(s) >= MIN_TITLE_KEYWORD_POPULARITY && isWinnable(s))
		.sort((a, b) => pop(b) - pop(a))[0];
	// The title carries a big word you cannot win - the most common ASO trap.
	const unwinnable = inTitle
		.filter((s) => pop(s) >= MIN_TITLE_KEYWORD_POPULARITY && !isWinnable(s))
		.sort((a, b) => b.difficulty - a.difficulty)[0];

	if (!titleKeyword && unwinnable) {
		issues.push({
			actionable: true,
			detail: bestTargets.length
				? `"${unwinnable.keyword}" in your title has difficulty ${unwinnable.difficulty} and you do not rank for it - that word is owned by apps far bigger than you. Swap it for something you can win, e.g. "${bestTargets[0].keyword}" (difficulty ${bestTargets[0].difficulty}).`
				: `"${unwinnable.keyword}" in your title has difficulty ${unwinnable.difficulty} and you do not rank for it. Broad single words are owned by the biggest apps in the category - a narrower phrase converts better.`,
			id: "title-unwinnable",
			scorePenalty: 14,
			severity: "high",
			title: `Your title targets a word you cannot win: "${unwinnable.keyword}"`,
		});
	} else if (!titleKeyword) {
		issues.push({
			actionable: true,
			detail: bestTargets.length
				? `Your title is the strongest ranking field, and it carries no keyword with real search volume. Best candidate: "${bestTargets[0].keyword}" (keep the title under ${TITLE_LIMIT_HINT} characters).`
				: `Your title is the strongest ranking field, and it carries no keyword with real search volume. Keep it under ${TITLE_LIMIT_HINT} characters and lead with what people search for.`,
			id: "title-keywords",
			scorePenalty: 18,
			severity: "high",
			title: "Title doesn't use a keyword people search for",
		});
	} else {
		strengths.push(
			`Title targets "${titleKeyword.keyword}" (popularity ${pop(titleKeyword)})`,
		);
		// The title works, but a materially bigger term may be within reach.
		const upgrade = suggestable
			.filter(
				(s) =>
					pop(s) >= pop(titleKeyword) + TITLE_UPGRADE_MARGIN &&
					// Only ever recommend a term the app can actually win, and
					// never a bare generic word - "room" beating "game show" on
					// estimated popularity is an artefact of strong competitors,
					// not an opportunity.
					isWinnable(s) &&
					s.keyword.includes(" ") &&
					!titleLower.includes(s.keyword.toLowerCase()),
			)
			.sort((a, b) => pop(b) - pop(a))[0];
		if (upgrade) {
			issues.push({
				actionable: true,
				detail: `Your title targets "${titleKeyword.keyword}" (popularity ${pop(titleKeyword)}). "${upgrade.keyword}" is searched far more (popularity ${pop(upgrade)}) at difficulty ${upgrade.difficulty}, and it is missing from your title.`,
				id: "title-upgrade",
				scorePenalty: 8,
				severity: "medium",
				title: `A bigger keyword is missing from your title: "${upgrade.keyword}"`,
			});
		}
	}

	// Screenshot count.
	if (app.screenshots > 0 && app.screenshots < GOOD_SCREENSHOT_COUNT) {
		issues.push({
			actionable: true,
			detail: `You have ${app.screenshots} screenshot${app.screenshots === 1 ? "" : "s"}; top apps in your category typically show ${GOOD_SCREENSHOT_COUNT}-10. More screens = more search-page real estate.`,
			id: "screenshots",
			scorePenalty: 10,
			severity: "medium",
			title: `Only ${app.screenshots} screenshots`,
		});
	} else if (app.screenshots >= GOOD_SCREENSHOT_COUNT) {
		strengths.push(`${app.screenshots} screenshots - good coverage`);
	}

	// Description quality.
	if (app.description.length < 400) {
		issues.push({
			actionable: true,
			detail: `Your description is ${app.description.length} characters. Short descriptions give the store (and users) little to index - aim for 1,500+ with your keywords woven in naturally.`,
			id: "description-short",
			scorePenalty: 12,
			severity: "medium",
			title: "Description is very short",
		});
	}
	const firstLine = app.description.split("\n")[0] ?? "";
	if (
		firstLine.length > 0 &&
		firstLine.toLowerCase().includes(app.name.split(/[:\s]/)[0].toLowerCase())
	) {
		issues.push({
			actionable: true,
			detail:
				"The first line of your description shows in previews. Lead with the user's benefit, not your app's name - they can already see the name.",
			id: "description-opening",
			scorePenalty: 5,
			severity: "low",
			title: "Description opens with your name, not a benefit",
		});
	}

	// The store you imported from speaks a language your listing does not.
	const wantLanguage = MARKET_LANGUAGE[app.country.toLowerCase()];
	const languages = app.languages ?? [];
	if (
		wantLanguage &&
		languages.length &&
		!hasLanguage(languages, wantLanguage)
	) {
		issues.push({
			actionable: true,
			detail: `You are listed in the ${app.country.toUpperCase()} store, but your listing ships only ${languages.join(", ")}. Local-language titles and keywords rank against local searches - this is usually the single biggest untapped market for an app already selling there.`,
			id: "no-local-listing",
			scorePenalty: 12,
			severity: "high",
			title: `No ${wantLanguage.toUpperCase()} listing for the ${app.country.toUpperCase()} store`,
		});
	}

	// Ratings. Neither of these can be fixed inside AppBoard, so they are
	// scored but flagged as context - the panel must not offer a dead button.
	if ((app.ratingsCount ?? 0) < 50) {
		issues.push({
			actionable: false,
			detail: `${app.ratingsCount ?? 0} ratings is below the credibility threshold. Add a well-timed in-app review prompt (after a success moment, never at launch).`,
			id: "few-ratings",
			scorePenalty: 10,
			severity: "medium",
			title: "Very few ratings",
		});
	} else if ((app.rating ?? 0) >= 4.5) {
		strengths.push(
			`${app.rating?.toFixed(1)} stars from ${app.ratingsCount} ratings`,
		);
	} else if ((app.rating ?? 0) > 0 && (app.rating ?? 0) < 4.0) {
		issues.push({
			actionable: false,
			detail: `A ${app.rating?.toFixed(1)} star average suppresses both ranking and conversion. Read the recent negative reviews and fix the #1 complaint first.`,
			id: "low-rating",
			scorePenalty: 12,
			severity: "high",
			title: "Rating below 4.0",
		});
	}

	// Freshness.
	if (app.updated) {
		const days = (Date.now() - new Date(app.updated).getTime()) / 86_400_000;
		if (days > OLD_UPDATE_DAYS) {
			issues.push({
				actionable: false,
				detail: `Last update was ${Math.round(days)} days ago. Stores favor actively maintained apps; even a small release helps.`,
				id: "stale-update",
				scorePenalty: 8,
				severity: "medium",
				title: "No update in 6+ months",
			});
		} else {
			strengths.push("Recently updated");
		}
	}

	// Ranking presence, measured on earned keywords only.
	const rankedEarned = earned.filter((s) => s.appRank);
	const rankedEchoes =
		scored.filter((s) => s.appRank).length - rankedEarned.length;
	if (rankedEarned.length) {
		strengths.push(
			`Ranks for ${rankedEarned.length} of ${earned.length} keywords beyond your own name`,
		);
		// Ranking is not the same as being found. Almost every tap happens on
		// the first screen, so a listing whose best earned rank is #16 is, in
		// practice, invisible - and that IS fixable from the panel.
		const best = rankedEarned
			.slice()
			.sort((a, b) => (a.appRank ?? 999) - (b.appRank ?? 999))[0];
		if ((best.appRank ?? 999) > VISIBLE_RANK) {
			issues.push({
				actionable: true,
				detail: `Your best position on a keyword that is not your own name is #${best.appRank} for "${best.keyword}". Almost nobody scrolls past the first ${VISIBLE_RANK} results, so these rankings bring close to no installs yet. Strengthen that one term in the title, subtitle and keyword field instead of adding new ones.`,
				id: "ranks-below-fold",
				scorePenalty: 8,
				severity: "high",
				title: `You rank, but nothing is on the first screen (best: #${best.appRank})`,
			});
		}
	} else if (rankedEchoes > 0) {
		issues.push({
			actionable: false,
			detail: `The only searches that find you are your own name and words already in your title (${rankedEchoes}). People who do not know your app cannot discover it yet - that is what the fixes above change.`,
			id: "brand-only-ranks",
			scorePenalty: 10,
			severity: "high",
			title: "You only rank for your own name",
		});
	} else if (earned.length) {
		issues.push({
			actionable: false,
			detail:
				"You are not in the top 200 for any of the keywords your own listing suggests. The fixes above are the fastest way to change that.",
			id: "no-ranks",
			scorePenalty: 10,
			severity: "high",
			title: "Not ranking for your own keywords",
		});
	}

	// Terms you could realistically win and are completely absent from. This
	// is the gap that costs the most installs, and unlike "rank higher" it
	// names the exact word to add.
	const gaps = suggestable
		.filter(
			(s) =>
				!s.appRank &&
				pop(s) >= GAP_MIN_POPULARITY &&
				s.difficulty <= GAP_MAX_DIFFICULTY,
		)
		.sort((a, b) => pop(b) - pop(a));
	if (gaps.length) {
		const names = gaps
			.slice(0, 3)
			.map((g) => `"${g.keyword}"`)
			.join(", ");
		issues.push({
			actionable: true,
			detail: `${names} ${gaps.length === 1 ? "is searched" : "are searched"} often (popularity ${gaps[0] ? pop(gaps[0]) : 0}${gaps.length > 1 ? " and down" : ""}) at a difficulty you can win (${gaps[0]?.difficulty ?? 0} or lower), and you are nowhere in the top 200 for ${gaps.length === 1 ? "it" : "them"}. Adding the strongest one to your subtitle and keyword field is the cheapest reach you can buy.`,
			id: "missing-winnable-terms",
			scorePenalty: 12,
			severity: "high",
			title: `${gaps.length} winnable keyword${gaps.length === 1 ? "" : "s"} you are absent from`,
		});
	}

	// Category check. Apps you actually compete with (rivals on terms you
	// already rank for, within the recommendable set) reveal where the store
	// files your kind of app. Sitting in a different category means competing
	// against unrelated traffic in the charts and the "similar apps" rails.
	const ownGenre = (app.genre.split(",")[0] ?? "").trim().toLowerCase();
	if (ownGenre) {
		const genreCounts = new Map<string, number>();
		let counted = 0;
		for (const s of suggestable.filter((x) => x.appRank != null)) {
			for (const c of (s.competitors ?? []).slice(
				0,
				CATEGORY_RIVALS_PER_TERM,
			)) {
				const g = (c.genre ?? "").split(",")[0]?.trim().toLowerCase();
				if (!g) continue;
				genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
				counted += 1;
			}
		}
		const [topGenre, topCount] = [...genreCounts.entries()].sort(
			(a, b) => b[1] - a[1],
		)[0] ?? ["", 0];
		if (
			counted >= CATEGORY_MIN_RIVALS &&
			topGenre &&
			topGenre !== ownGenre &&
			topCount / counted >= CATEGORY_MAJORITY
		) {
			const label = topGenre.replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
			issues.push({
				actionable: true,
				detail: `${topCount} of the ${counted} apps that outrank you on your own keywords are filed under "${label}", and you are in "${app.genre.split(",")[0]?.trim()}". Charts and "you might also like" rails are per category - in the wrong one you compete against apps nobody compares you with.`,
				id: "category-mismatch",
				scorePenalty: 6,
				severity: "medium",
				title: `Your category may be wrong: rivals sit in "${label}"`,
			});
		}
	}

	const penalty = issues.reduce((sum, issue) => sum + issue.scorePenalty, 0);
	const asoScore = Math.max(5, Math.min(100, BASE_SCORE - penalty));
	const themes = extractKeywordCandidates(app).slice(0, 4);

	for (const issue of issues) {
		issue.appboard = APPBOARD_FIXES[issue.id];
	}

	return { asoScore, issues, strengths, themes };
}

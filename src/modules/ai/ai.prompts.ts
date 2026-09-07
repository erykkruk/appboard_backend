/**
 * The one source of the listing-copy prompts. The runtime falls back to these
 * when a workspace or app has not overridden a prompt, and the Settings page
 * shows exactly these as "default" - two texts drifting apart was the old bug.
 */
export type ListingField =
	| "title"
	| "subtitle"
	| "shortDescription"
	| "description"
	| "fullDescription"
	| "keywords"
	| "promotionalText"
	| "whatsNew";

export type PromptMode = "generate" | "rephrase";

export type StorePlatform = "ios" | "android";

/** Limits on the App Store; Google Play differs only where fieldLimit says so. */
export const FIELD_LIMITS: Record<ListingField, number> = {
	description: 4000,
	fullDescription: 4000,
	keywords: 100,
	promotionalText: 170,
	shortDescription: 80,
	subtitle: 30,
	title: 30,
	whatsNew: 4000,
};

/** Google Play Console caps release notes at 500 characters per language. */
const PLAY_RELEASE_NOTES_LIMIT = 500;

/** The hard cap for a field on a store - the number every prompt states. */
export function fieldLimit(
	field: ListingField,
	platform: StorePlatform,
): number {
	if (field === "whatsNew" && platform === "android") {
		return PLAY_RELEASE_NOTES_LIMIT;
	}
	return FIELD_LIMITS[field];
}

/** Where each field lives; used when Settings shows a default without a platform. */
const NATIVE_PLATFORM: Record<ListingField, StorePlatform> = {
	description: "ios",
	fullDescription: "android",
	keywords: "ios",
	promotionalText: "ios",
	shortDescription: "android",
	subtitle: "ios",
	title: "ios",
	whatsNew: "ios",
};

/**
 * Named code points, because "no typographic dashes" is a category most
 * models only half obey. Reused by every prompt that produces pasted text.
 */
export const PLAIN_TEXT =
	"Plain text only: no emoji, no decorative symbols. Use the ASCII hyphen-minus (U+002D) for every dash and ASCII quotes (U+0022, U+0027). Never an em dash (U+2014), an en dash (U+2013), curly quotes (U+2018, U+2019, U+201C, U+201D) or the ellipsis character (U+2026) - write three dots instead.";

const ROLE = `You are a senior App Store Optimization copywriter. You write listing copy that ranks in store search and converts the people who read it, and you know exactly what App Store Connect and Google Play Console reject.`;

const PRINCIPLES = `Principles (the field rules further down are more specific and win when they differ):
- Benefit first: what the reader gets, in the words they would use, before how the app does it.
- Specific over vague: outcomes, concrete nouns and real numbers from the brief. No filler ("amazing", "powerful", "seamless", "best-in-class").
- In sentence fields (descriptions, promotional text, release notes): short sentences, active voice, second person, written for a person scanning on a phone. The title, subtitle and short description are phrases; the iOS keyword field is the one field that is a list.
- Never invent. Use only features, numbers, awards, quotes and ratings that the brief or the current text states. If a section has no material, leave it out instead of making it up.
- No absolute or unverifiable claims: no "guaranteed", "100%", "unlimited", "cures", "the fastest", "the most accurate", no medical, financial or weight-loss outcomes, no endorsements ("doctor-recommended", "Editors' Choice", "featured") unless the brief states them with a source.
- Search terms earn a place only by relevance to what the app does. In sentences and bullet lines never a bare list of keywords or unnatural repetition - both stores reject stuffed metadata.
- Other apps' names and third-party trademarks never appear in the title, subtitle, short description or keyword field. In a description or release notes name a third-party product only as a compatibility or integration fact ("syncs with Google Calendar", "works on Apple Watch", "imports Excel files"), never as a comparison, an endorsement or an "alternative to X".
- In the title, subtitle, short description and keyword field never use words about price, ranking or newness ("free", "best", "#1", "top", "new", "sale", "update") - both stores reject them there. In the description, promotional text and release notes state price and offers as plain facts with a date ("Free to start, Pro from 4.99 EUR a month", "Half price until 30 June"), never as hype ("download now", "limited time only").
- App Store metadata must not name other platforms or their stores (Android, Google Play, Windows, Huawei, Samsung): Apple Guideline 2.3.10. Remove such mentions when rephrasing or localizing, even if the source text has them. On Google Play do not name Apple products or the App Store either; describe cross-platform sync as "syncs across your devices".
- Metadata must be suitable for all ages whatever the app's rating (Apple 2.3.8): no profanity, sexual, violent or drug references in any field.
- ${PLAIN_TEXT} App Store Connect blocks emoji in the name, subtitle and keyword field; Google Play forbids emoji, emoticons, special characters and ALL CAPS in the title; every field stays plain for legibility.`;

const OUTPUT = `Output rules:
- Return only the finished text for the field: no label, no quotes around it, no markdown, no explanation, no alternatives.
- The character limit is a hard cap. For 30-character fields aim for 24 to 28 characters; for the keyword field use 90 to 100 of the 100. Count once more before answering; if over, remove a whole word and count again. Never cut a word or a sentence in half.
- Write in the language stated in the task. If the current text is in another language, rewrite it into the requested one.
- Keep the brand name exactly as given - never translate or transliterate it.`;

const IOS_FACTS = `Store facts - Apple App Store:
- Search indexes the title (30 characters), the subtitle (30) and the keyword field (100). Every word is indexed once across the three, so a word used in the title must not appear again in the subtitle or the keyword field.
- The description (4000) and the promotional text (170) are not indexed. They exist to convert.
- Only the first three lines of the description show before "more"; most readers never tap it.
- A storefront indexes several localizations at once (the US indexes English (U.S.) and Spanish (Mexico); most European storefronts index the local language and English (U.K.)). A secondary localization is extra title, subtitle and keyword budget for the same storefront.
- Apple rejects promotional words and other apps' names in the name, subtitle and keyword field.`;

const ANDROID_FACTS = `Store facts - Google Play:
- Search indexes the title (30 characters), the short description (80) and the full description (4000). After the title, the short description carries the most weight; the full description is read for relevance across the whole text, so the words that matter should recur naturally.
- On the listing the short description is the only descriptive text visible without a tap (it sits under "About this app"); the full description opens behind the arrow. Its opening still has to stand on its own for the readers who open it and for web search snippets, but the short description does the selling.
- Google Play title rules: no emoji, emoticons or special characters, no ALL CAPS outside the brand, no words about price, ranking or newness.
- Google Play description rules: no keyword lists or unnaturally repeated words, no unattributed or anonymous user testimonials, no references to other apps.`;

type FieldRules = Record<PromptMode, string>;

const REPHRASE_COMMON = `You are improving an existing text, not writing a new one. Keep the facts, the brand name, the language and the meaning. Cut weak words, fix the structure, strengthen the opening. Store rules come first: if the current text contains a competitor or third-party name, a promotional or ranking word, pricing in a title or subtitle, emoji or symbols, ALL CAPS, a mention of another platform or an anonymous testimonial, remove or replace it even though it changes the text - that is part of the improvement, not a loss of meaning. If the current text already follows every rule, return it with the smallest possible changes.`;

function titleRules(platform: StorePlatform): FieldRules {
	const shared = `Field: app title (max 30 characters, aim for 24 to 28). The strongest ranking signal on both stores and the first thing a searcher reads.
- Pattern: "Brand: what it does" or "Brand - main benefit". The brand first, then the single most searched phrase that describes the app, joined by a colon or a plain hyphen.
- Pick that phrase for search demand and relevance to the app; a narrow phrase people search beats a broad word owned by giants.
- No generic words like "app", "mobile" or "tool" unless they are part of the brand.${platform === "android" ? "\n- Google Play: no ALL CAPS, no emoticons, no punctuation for decoration, no ranking or promotional words." : ""}`;
	return {
		generate: shared,
		rephrase: `${shared}\n\n${REPHRASE_COMMON}`,
	};
}

function subtitleRules(): FieldRules {
	const shared = `Field: iOS subtitle (max 30 characters, aim for 24 to 28). The second strongest ranking signal on the App Store and the line under the title in search results.
- Pattern: an outcome or a specific benefit, for example "Focus timer and daily streaks".
- Use it for the searched phrases that did not fit the title. Never repeat a word from the title (the current title is given in the task) - each word is indexed once.
- It must read as a natural phrase, not a keyword list.`;
	return { generate: shared, rephrase: `${shared}\n\n${REPHRASE_COMMON}` };
}

function shortDescriptionRules(): FieldRules {
	const shared = `Field: Google Play short description (max 80 characters). The most indexed text after the title and the only descriptive text visible without a tap.
- Pattern: action verb + the core benefit + what makes it different, in one natural sentence.
- Google Play has no once-per-word rule: repeat the core search term from the title once, then add one or two secondary phrases that are not in the title. Never paste the whole title; the 80 characters are for new information around the same core term.
- The primary search phrase within the first four words.
- It has to stop a scroll: concrete and plain, no hype.`;
	return { generate: shared, rephrase: `${shared}\n\n${REPHRASE_COMMON}` };
}

function descriptionRules(platform: StorePlatform): FieldRules {
	const indexing =
		platform === "ios"
			? `On the App Store the description is not indexed for search, so write it entirely for conversion: clarity and proof beat keyword placement; use search phrases only where they make the copy clearer.`
			: `On Google Play the description is indexed. Use the primary search phrase in the first sentence and let the important phrases recur naturally three to five times across the text; never as a list, never more often than a person would say them.`;
	const shared = `Field: app description (max 4000 characters). ${indexing}
Structure:
1. Opening (two or three lines, the only part most people read): the reader's situation and the outcome the app delivers. No "Welcome to", no restating the app name.
2. Benefits: four to six short bullet lines, each "benefit - how the app does it", using a plain hyphen as the bullet.
3. What makes it different: two or three points competitors do not have, only if the brief supports them.
4. Proof: ratings, numbers, awards or press quotes given in the brief, each with a named, verifiable source (a publication, an award body, a named person). Never anonymous or unattributed user reviews: Google Play rejects descriptions that quote users without attribution, so on Google Play leave user testimonials out entirely; on the App Store use them only with a name. With no proof in the brief, skip this section.
5. Close: one clear next step.
Paragraphs of one to three sentences, blank line between sections. No headings in capitals, no emoji, no symbols.`;
	return { generate: shared, rephrase: `${shared}\n\n${REPHRASE_COMMON}` };
}

function keywordsRules(): FieldRules {
	const shared = `Field: iOS keyword field (max 100 characters). Indexed together with the title and subtitle.
- Comma-separated terms, no space after a comma, so every character carries a word.
- Use the whole budget: aim for 90 to 100 characters; a short list is a lost ranking.
- Never repeat a word that is already in the title or the subtitle (both are given in the task) - it would be wasted.
- Single words are matched in any combination: prefer separate words to phrases unless the phrase only ranks as a whole.
- No stop words ("a", "the", "and", "for", "with", "your") - Apple ignores them.
- English: singular forms, Apple matches plurals. Inflected languages (Polish, German, Russian, Turkish): the form people actually type into the store.
- No app names, no competitor or third-party brands, not this app's own name, developer name or category name (Apple indexes those already), no "app", no punctuation other than commas.
- Choose by relevance first, then search demand, then how winnable the term is for an app of this size.`;
	return { generate: shared, rephrase: `${shared}\n\n${REPHRASE_COMMON}` };
}

function promotionalTextRules(): FieldRules {
	const shared = `Field: iOS promotional text (max 170 characters). Shown above the description, not indexed, changeable without a review.
- One or two sentences about what is new or timely and the benefit for the reader.
- Concrete: a feature, an event, an improvement, an offer stated as a fact with a date. No countdown urgency you cannot honour.`;
	return { generate: shared, rephrase: `${shared}\n\n${REPHRASE_COMMON}` };
}

function whatsNewRules(platform: StorePlatform): FieldRules {
	const limit = fieldLimit("whatsNew", platform);
	const storeLine =
		platform === "android"
			? "Google Play: 500 characters in total and Play Console rejects anything longer - three or four short lines, the most felt change first."
			: "App Store: lead with the change people will feel most, then the rest as short lines.";
	const shared = `Field: what's new / release notes (max ${limit} characters).
- ${storeLine}
- Lead with the change people will feel most, as a benefit ("Search results now load in under a second"), then the rest as short bullet lines with a plain hyphen.
- Positive framing for fixes ("Sync no longer drops on weak connections"), one line for minor fixes together.
- Only changes that actually shipped; nothing planned, nothing vague ("various improvements").
- Close with one sentence inviting feedback or a rating, without pressure.`;
	return { generate: shared, rephrase: `${shared}\n\n${REPHRASE_COMMON}` };
}

function fieldRules(field: ListingField, platform: StorePlatform): FieldRules {
	switch (field) {
		case "title":
			return titleRules(platform);
		case "subtitle":
			return subtitleRules();
		case "shortDescription":
			return shortDescriptionRules();
		case "description":
			return descriptionRules(platform);
		case "fullDescription":
			return descriptionRules("android");
		case "keywords":
			return keywordsRules();
		case "promotionalText":
			return promotionalTextRules();
		case "whatsNew":
			return whatsNewRules(platform);
	}
}

/**
 * The full system prompt for one field on one store. Role, shared
 * principles, the store's indexing facts, the field's own rules, output
 * rules - in that order, so the model reads the constraints before the task.
 */
export function buildListingSystemPrompt(
	field: ListingField,
	mode: PromptMode,
	platform: StorePlatform,
): string {
	const facts = platform === "ios" ? IOS_FACTS : ANDROID_FACTS;
	return [
		ROLE,
		PRINCIPLES,
		facts,
		fieldRules(field, platform)[mode],
		OUTPUT,
	].join("\n\n");
}

export const LISTING_FIELDS: ListingField[] = [
	"title",
	"subtitle",
	"shortDescription",
	"description",
	"fullDescription",
	"keywords",
	"promotionalText",
	"whatsNew",
];

export const PROMPT_MODES: PromptMode[] = ["generate", "rephrase"];

/** What Settings shows as the default: the field on its native store. */
export function getDefaultPrompt(
	field: ListingField,
	mode: PromptMode,
): string {
	return buildListingSystemPrompt(field, mode, NATIVE_PLATFORM[field]);
}

export function getSettingKey(field: ListingField, mode: PromptMode): string {
	return `AI_PROMPT_${mode.toUpperCase()}_${field.toUpperCase()}`;
}

/**
 * Per-field rules for localization. A translation is a rewrite for another
 * market: the same limits, the same store policies, and search phrases that
 * people in that market actually type - not the source words in another
 * language.
 */
export function buildTranslationFieldRules(field: string): string {
	switch (field) {
		case "title":
			return `TITLE (max 30 characters, aim for 24 to 28, count them):
- Keep the brand name exactly as it is - never translate or transliterate it.
- Replace the descriptive part with the phrase people in the target market search for; a literal translation of the source phrase is usually not it.
- No generic words ("app", "tool"), no promotional words, no emoji or symbols.`;
		case "subtitle":
			return `SUBTITLE (max 30 characters, aim for 24 to 28, count them):
- A natural phrase with a specific benefit, in words the target market searches for.
- Never repeat a word from the translated title - each word is indexed once.
- It must read as native copy, never as a translation.`;
		case "shortDescription":
			return `SHORT DESCRIPTION (max 80 characters, count them):
- Action verb + core benefit + differentiator, in one natural sentence.
- Google Play has no once-per-word rule: repeat the core term from the translated title once, then add one or two secondary phrases that are not in the title; never paste the whole title.
- The market's primary search phrase within the first four words.
- Plain, concrete, no hype, no ALL CAPS, no emoticons.`;
		case "description":
			return `DESCRIPTION - App Store (max 4000 characters):
- Not indexed for search: translate for conversion. Keep the structure (opening, benefits, differentiators, proof, close) and the bullet lines.
- Adapt idioms, examples, humor and social proof to the target market; drop a reference that does not exist there rather than translate it literally.
- The first three lines must stand on their own: that is all most readers see.`;
		case "fullDescription":
			return `FULL DESCRIPTION - Google Play (max 4000 characters):
- Indexed for search: the market's primary phrase in the first sentence, important phrases recurring naturally three to five times, never listed.
- Keep the structure and the bullet lines; adapt idioms, examples and proof to the market; no anonymous user testimonials.
- Nothing Google Play rejects: no emoticons, no ALL CAPS, no ranking or promotional words, no keyword lists, no references to other apps.`;
		case "keywords":
			return `KEYWORDS (max 100 characters, use 90 to 100, count them):
- Not a translation: the terms people in the target market type into the store. When the literal translation is not what they search, use what they search.
- Comma-separated, no space after commas, no stop words, no word already in the translated title or subtitle.
- English: singular forms. Inflected languages: the form people actually type.
- No app names, brands or trademarks, not this app's own name or category, no punctuation other than commas.`;
		case "promotionalText":
			return `PROMOTIONAL TEXT (max 170 characters):
- One or two sentences on what is new or timely and the benefit; not indexed, so write for the reader.
- Match the market's register: some markets prefer understated and factual, others respond to energy. Keep every claim true; state offers as facts with a date.`;
		case "whatsNew":
			return `WHAT'S NEW (max 4000 characters on the App Store, max 500 on Google Play):
- Lead with the change people feel most, as a benefit; short bullet lines with a plain hyphen; positive framing for fixes.
- Adapt idioms and the closing invitation to local conventions; keep only changes that actually shipped.`;
		default:
			return "";
	}
}

export function getAllDefaultPrompts(): Record<string, string> {
	const defaults: Record<string, string> = {};
	for (const field of LISTING_FIELDS) {
		for (const mode of PROMPT_MODES) {
			const key = getSettingKey(field, mode);
			defaults[key] = getDefaultPrompt(field, mode);
		}
	}
	return defaults;
}

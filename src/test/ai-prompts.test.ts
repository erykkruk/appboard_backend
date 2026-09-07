import { describe, expect, it } from "bun:test";
import {
	buildListingSystemPrompt,
	buildTranslationFieldRules,
	FIELD_LIMITS,
	fieldLimit,
	getAllDefaultPrompts,
	getDefaultPrompt,
	LISTING_FIELDS,
	PROMPT_MODES,
} from "@/modules/ai/ai.prompts";

/** Characters the stores reject and the house style bans in generated text. */
const TYPOGRAPHIC = /[–—‘’“”…]/;

/** Every file that holds prompt text: what the model reads must be clean too. */
const PROMPT_SOURCES = [
	"../modules/ai/ai.prompts.ts",
	"../modules/ai/ai.service.ts",
	"../modules/ai/monetization.prompts.ts",
	"../modules/ai/monetization-chat.service.ts",
	"../modules/audit/audit-ai.service.ts",
	"../modules/research/research.ai.ts",
];

describe("listing prompts", () => {
	it("exist for every field and mode and carry the field's limit", () => {
		const defaults = getAllDefaultPrompts();
		expect(Object.keys(defaults)).toHaveLength(
			LISTING_FIELDS.length * PROMPT_MODES.length,
		);
		for (const field of LISTING_FIELDS) {
			for (const mode of PROMPT_MODES) {
				const prompt = getDefaultPrompt(field, mode);
				expect(prompt).toContain(`max ${FIELD_LIMITS[field]} characters`);
				expect(prompt).toContain("no emoji");
				expect(prompt).not.toMatch(TYPOGRAPHIC);
			}
		}
	});

	it("rephrase keeps the facts but lets store rules win over the wording", () => {
		const rephrase = getDefaultPrompt("title", "rephrase");
		expect(rephrase).toContain("Keep the facts");
		expect(rephrase).toContain("Store rules come first");
		expect(getDefaultPrompt("title", "generate")).not.toContain(
			"Keep the facts",
		);
	});

	it("knows which store each field is written for", () => {
		const ios = buildListingSystemPrompt("description", "generate", "ios");
		const play = buildListingSystemPrompt("description", "generate", "android");
		expect(ios).toContain("not indexed");
		expect(play).not.toContain("not indexed");
		expect(play).toContain("the description is indexed");
		expect(play).toContain("Google Play");
		expect(buildListingSystemPrompt("title", "generate", "android")).toContain(
			"no ALL CAPS",
		);
	});

	it("caps Google Play release notes at 500 characters, App Store at 4000", () => {
		expect(fieldLimit("whatsNew", "android")).toBe(500);
		expect(fieldLimit("whatsNew", "ios")).toBe(4000);
		expect(fieldLimit("title", "android")).toBe(30);
		expect(
			buildListingSystemPrompt("whatsNew", "generate", "android"),
		).toContain("max 500 characters");
		expect(buildListingSystemPrompt("whatsNew", "generate", "ios")).toContain(
			"max 4000 characters",
		);
	});

	it("keeps other apps' names out of the indexed fields and promo words out of titles", () => {
		const keywords = getDefaultPrompt("keywords", "generate");
		expect(keywords).toContain("No app names, no competitor");
		expect(keywords).toContain("No stop words");
		expect(keywords).toContain("90 to 100 characters");
		for (const field of LISTING_FIELDS) {
			const prompt = getDefaultPrompt(field, "generate");
			expect(prompt).toContain("Other apps' names and third-party trademarks");
			expect(prompt).toContain("Apple Guideline 2.3.10");
			expect(prompt).toContain('"free", "best", "#1"');
		}
	});

	it("tells the model what the App Store does and does not index", () => {
		const subtitle = buildListingSystemPrompt("subtitle", "generate", "ios");
		expect(subtitle).toContain("Every word is indexed once");
		expect(subtitle).toContain("storefront indexes several localizations");
		const short = buildListingSystemPrompt(
			"shortDescription",
			"generate",
			"android",
		);
		expect(short).toContain("Google Play has no once-per-word rule");
	});

	it("Settings defaults are the very text the runtime falls back to", () => {
		expect(getDefaultPrompt("subtitle", "generate")).toBe(
			buildListingSystemPrompt("subtitle", "generate", "ios"),
		);
		expect(getDefaultPrompt("shortDescription", "rephrase")).toBe(
			buildListingSystemPrompt("shortDescription", "rephrase", "android"),
		);
		expect(getDefaultPrompt("whatsNew", "generate")).toBe(
			buildListingSystemPrompt("whatsNew", "generate", "ios"),
		);
	});

	it("translation rules keep limits, policies and the brand", () => {
		expect(buildTranslationFieldRules("title")).toContain("max 30 characters");
		expect(buildTranslationFieldRules("title")).toContain(
			"Keep the brand name",
		);
		expect(buildTranslationFieldRules("keywords")).toContain("no stop words");
		expect(buildTranslationFieldRules("keywords")).toContain(
			"Not a translation",
		);
		expect(buildTranslationFieldRules("fullDescription")).toContain(
			"Google Play",
		);
		expect(buildTranslationFieldRules("whatsNew")).toContain(
			"max 500 on Google Play",
		);
		expect(buildTranslationFieldRules("unknown")).toBe("");
		for (const field of LISTING_FIELDS) {
			expect(buildTranslationFieldRules(field)).not.toMatch(TYPOGRAPHIC);
		}
	});

	it("prompt source files contain no typographic dashes, quotes or ellipses", async () => {
		for (const relative of PROMPT_SOURCES) {
			const source = await Bun.file(`${import.meta.dir}/${relative}`).text();
			const hit = source.match(TYPOGRAPHIC);
			expect(hit ? `${relative}: ${hit[0]}` : null).toBeNull();
		}
	});
});

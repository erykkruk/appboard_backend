import { describe, expect, it } from "bun:test";
import {
	buildListingSystemPrompt,
	buildTranslationFieldRules,
	FIELD_LIMITS,
	getAllDefaultPrompts,
	getDefaultPrompt,
	LISTING_FIELDS,
	PROMPT_MODES,
} from "@/modules/ai/ai.prompts";

/** Characters the stores reject and the house style bans in generated text. */
const TYPOGRAPHIC = /[—–‘’“”…]/;

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

	it("rephrase keeps the facts while generate does not carry the rephrase rule", () => {
		expect(getDefaultPrompt("title", "rephrase")).toContain("Keep every fact");
		expect(getDefaultPrompt("title", "generate")).not.toContain(
			"Keep every fact",
		);
	});

	it("knows which store each field is written for", () => {
		const ios = buildListingSystemPrompt("description", "generate", "ios");
		const play = buildListingSystemPrompt("description", "generate", "android");
		expect(ios).toContain("not indexed for search");
		expect(play).toContain("the description is indexed");
		expect(play).toContain("Google Play");
		expect(buildListingSystemPrompt("title", "generate", "android")).toContain(
			"no ALL CAPS",
		);
	});

	it("never sends competitor names or store-flagged words into metadata", () => {
		const keywords = getDefaultPrompt("keywords", "generate");
		expect(keywords).toContain("No app names, no competitor");
		expect(keywords).not.toContain("Include competitor names");
		for (const field of LISTING_FIELDS) {
			expect(getDefaultPrompt(field, "generate")).toContain(
				"No competitor names",
			);
		}
	});

	it("Settings defaults are the very text the runtime falls back to", () => {
		expect(getDefaultPrompt("subtitle", "generate")).toBe(
			buildListingSystemPrompt("subtitle", "generate", "ios"),
		);
		expect(getDefaultPrompt("shortDescription", "rephrase")).toBe(
			buildListingSystemPrompt("shortDescription", "rephrase", "android"),
		);
	});

	it("translation rules keep limits, policies and the brand", () => {
		expect(buildTranslationFieldRules("title")).toContain("max 30 characters");
		expect(buildTranslationFieldRules("title")).toContain(
			"Keep the brand name",
		);
		expect(buildTranslationFieldRules("keywords")).toContain("No app names");
		expect(buildTranslationFieldRules("fullDescription")).toContain(
			"Google Play",
		);
		expect(buildTranslationFieldRules("unknown")).toBe("");
		for (const field of LISTING_FIELDS) {
			expect(buildTranslationFieldRules(field)).not.toMatch(TYPOGRAPHIC);
		}
	});
});

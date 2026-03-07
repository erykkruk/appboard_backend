import { t } from "elysia";

export const groupAsoProfileParams = t.Object({
	groupId: t.String({ format: "uuid" }),
});

const nullableString = t.Optional(t.Union([t.String(), t.Null()]));
const nullableStringArray = t.Optional(
	t.Union([t.Array(t.String()), t.Null()]),
);

export const enableSharedProfileBody = t.Object({
	sourceAppId: t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()])),
});

export const upsertGroupAsoProfileBody = t.Object({
	// Social Proof
	awards: nullableStringArray,

	// Tone & Branding
	brandVoiceExample: nullableString,

	// Core Information
	category: nullableString,

	// Competitors
	competitiveAdvantage: nullableString,
	competitors: nullableStringArray,
	differentiator: nullableString,
	downloadCount: nullableString,

	// Keywords
	excludeKeywords: nullableStringArray,

	// Product Details
	freeFeatures: nullableStringArray,
	keyFeatures: nullableStringArray,
	longTailKeywords: nullableStringArray,
	mainBenefit: nullableString,
	mustIncludeKeywords: nullableStringArray,
	oneLiner: nullableString,

	// Audience
	painPoints: nullableStringArray,
	positioning: nullableString,
	premiumFeatures: nullableStringArray,
	pressQuotes: nullableStringArray,
	price: nullableString,
	pricingModel: nullableString,
	problem: nullableString,
	targetAudience: nullableString,
	testimonials: nullableStringArray,
	tone: nullableString,
	userLanguage: nullableString,
	wordsToAvoid: nullableStringArray,
	wordsToInclude: nullableStringArray,
});

import { t } from "elysia";

export const asoProfileParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

const nullableString = t.Optional(t.Union([t.String(), t.Null()]));
const nullableStringArray = t.Optional(
	t.Union([t.Array(t.String()), t.Null()]),
);

export const upsertAsoProfileBody = t.Object({
	// Social Proof
	awards: nullableStringArray,
	downloadCount: nullableString,
	pressQuotes: nullableStringArray,
	testimonials: nullableStringArray,

	// Tone & Branding
	brandVoiceExample: nullableString,
	tone: nullableString,
	wordsToAvoid: nullableStringArray,
	wordsToInclude: nullableStringArray,

	// Core Information
	category: nullableString,
	differentiator: nullableString,
	keyFeatures: nullableStringArray,
	mainBenefit: nullableString,
	oneLiner: nullableString,
	problem: nullableString,

	// Competitors
	competitiveAdvantage: nullableString,
	competitors: nullableStringArray,
	positioning: nullableString,

	// Keywords
	excludeKeywords: nullableStringArray,
	longTailKeywords: nullableStringArray,
	mustIncludeKeywords: nullableStringArray,

	// Product Details
	freeFeatures: nullableStringArray,
	premiumFeatures: nullableStringArray,
	price: nullableString,
	pricingModel: nullableString,

	// Audience
	painPoints: nullableStringArray,
	targetAudience: nullableString,
	userLanguage: nullableString,
});

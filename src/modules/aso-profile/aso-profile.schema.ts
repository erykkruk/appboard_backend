import { t } from "elysia";

export const asoProfileParams = t.Object({
	appId: t.String({ format: "uuid" }),
});

const stringArray = t.Optional(t.Array(t.String()));

export const upsertAsoProfileBody = t.Object({
	// Optional D: Social Proof
	awards: stringArray,

	// Optional C: Tone & Branding
	brandVoiceExample: t.Optional(t.String()),
	// Required: Core Information
	category: t.Optional(t.String({ maxLength: 100 })),

	// Optional B: Competitors
	competitiveAdvantage: t.Optional(t.String()),
	competitors: stringArray,
	differentiator: t.Optional(t.String()),
	downloadCount: t.Optional(t.String({ maxLength: 50 })),

	// Optional F: Keywords
	excludeKeywords: stringArray,

	// Optional E: Product Details
	freeFeatures: stringArray,
	keyFeatures: stringArray,
	longTailKeywords: stringArray,
	mainBenefit: t.Optional(t.String()),
	mustIncludeKeywords: stringArray,
	oneLiner: t.Optional(t.String({ maxLength: 300 })),

	// Optional A: Audience
	painPoints: stringArray,
	positioning: t.Optional(t.String({ maxLength: 50 })),
	premiumFeatures: stringArray,
	pressQuotes: stringArray,
	price: t.Optional(t.String({ maxLength: 100 })),
	pricingModel: t.Optional(t.String({ maxLength: 50 })),
	problem: t.Optional(t.String()),
	targetAudience: t.Optional(t.String()),
	testimonials: stringArray,
	tone: t.Optional(t.String({ maxLength: 50 })),
	userLanguage: t.Optional(t.String()),
	wordsToAvoid: stringArray,
	wordsToInclude: stringArray,
});

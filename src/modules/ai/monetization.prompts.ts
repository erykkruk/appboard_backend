// ── Types ──────────────────────────────────────────────────────────────────

export type MonetizationChatField =
	| "monetizationRole"
	| "monetizationKnowledge"
	| "pricingRules"
	| "conversationGuidelines";

export type PurchasePromptField =
	| "purchaseName"
	| "purchaseDescription"
	| "reviewNotes"
	| "productId"
	| "groupName"
	| "groupDescription";

export type PurchasePromptMode = "generate" | "rephrase";

// ── Field lists ────────────────────────────────────────────────────────────

export const MONETIZATION_CHAT_FIELDS: {
	key: MonetizationChatField;
	label: string;
	description: string;
}[] = [
	{
		description:
			"Defines the AI's role, expertise, and decision-making framework for monetization consulting.",
		key: "monetizationRole",
		label: "Role & Expertise",
	},
	{
		description:
			"Product types, durations, naming conventions, pricing tiers, and category-to-model matrix.",
		key: "monetizationKnowledge",
		label: "Product Knowledge",
	},
	{
		description:
			"PPP tiers, pricing psychology (anchoring, decoy, charm pricing), and regional price adjustments.",
		key: "pricingRules",
		label: "Pricing Rules",
	},
	{
		description:
			"How the AI behaves in conversation — decisiveness, context usage, and response format.",
		key: "conversationGuidelines",
		label: "Conversation Guidelines",
	},
];

export const PURCHASE_FIELDS: {
	key: PurchasePromptField;
	label: string;
	description: string;
}[] = [
	{
		description: "Display name for in-app purchases (max 30 characters).",
		key: "purchaseName",
		label: "Purchase Name",
	},
	{
		description:
			"Description shown below the purchase name (max 45 characters).",
		key: "purchaseDescription",
		label: "Purchase Description",
	},
	{
		description:
			"Notes for App Store review team explaining the purchase (max 4000 characters).",
		key: "reviewNotes",
		label: "Review Notes",
	},
	{
		description:
			"Product identifier in reverse-domain format (e.g. com.app.premium.monthly).",
		key: "productId",
		label: "Product ID",
	},
	{
		description: "Subscription group name (max 30 characters).",
		key: "groupName",
		label: "Group Name",
	},
	{
		description: "Subscription group description (max 45 characters).",
		key: "groupDescription",
		label: "Group Description",
	},
];

export const PURCHASE_PROMPT_MODES: PurchasePromptMode[] = [
	"generate",
	"rephrase",
];

// ── Setting key helpers ────────────────────────────────────────────────────

export function getMonetizationSettingKey(
	field: MonetizationChatField,
): string {
	return `AI_PROMPT_CHAT_${field.toUpperCase()}`;
}

export function getPurchaseSettingKey(
	field: PurchasePromptField,
	mode: PurchasePromptMode,
): string {
	return `AI_PROMPT_${mode.toUpperCase()}_${field.toUpperCase()}`;
}

// ── Default monetization chat prompts ──────────────────────────────────────

const DEFAULT_MONETIZATION_ROLE = `You are an expert mobile app monetization consultant with deep knowledge of App Store and Google Play economics (2025-2026).

Your expertise includes:
- In-app purchase design (consumables, non-consumables, auto-renewable subscriptions)
- Subscription plan architecture (tier design, pricing psychology, trial optimization)
- Revenue maximization strategies (anchoring, decoy effect, PPP pricing)
- Category-specific monetization patterns (games, productivity, fitness, education, etc.)
- App Store Connect and Google Play Console best practices

Decision framework — when suggesting a strategy:
1. Identify the app's VALUE TYPE from its description:
   - Continuous content/value → Subscription
   - One-time tool → One-time purchase
   - Internal economy (coins, gems) → Consumable IAP
   - Social/community features → Freemium + IAP cosmetics
   - High-traffic free app → Ads + optional premium

2. Map the CATEGORY to a default strategy using the category→model matrix
3. Analyze EXISTING purchases — flag red flags (single plan, no trial, pricing issues)
4. Generate a CONCRETE plan with specific prices, product IDs, and durations`;

const DEFAULT_MONETIZATION_KNOWLEDGE = `MONETIZATION KNOWLEDGE:
- Product types: "consumable" (repeatable, e.g. coins), "non_consumable" (one-time, e.g. remove ads), "auto_renewable" (subscriptions)
- Subscription durations (ISO 8601): P1W (weekly), P1M (monthly), P3M (quarterly), P6M (semi-annual), P1Y (annual)
- Product IDs: lowercase_snake_case convention (e.g. "pro_monthly", "remove_ads", "coins_100")

CATEGORY → MODEL MATRIX:
| Category | Primary Model | Alternative |
|----------|--------------|-------------|
| Games — Casual | IAP consumables + Ads | Battle Pass |
| Games — Strategy/RPG | IAP + Season Pass | VIP Sub |
| Productivity | Freemium + Subscription | One-time unlock |
| Fitness / Health | Subscription | Freemium + IAP |
| Education | Freemium + Subscription | IAP (courses) |
| Photo / Video | Freemium + Subscription | One-time filters |
| Social | Freemium + IAP | Sub (premium tier) |
| Finance | Freemium + Premium | Subscription |
| News / Media | Paywall + Subscription | Ads |
| Music | Subscription | Ads (free tier) |
| Utility / Tools | One-time purchase | Freemium |
| Dating | Freemium + Sub + IAP | Boosts, super likes |
| Kids | One-time purchase | Sub (parental) |
| Travel | Sub / IAP | Affiliate |
| Business / SaaS | Sub (tiers) | Per-seat pricing |

PLAN STRUCTURE (Golden Rule: 3 Plans with Decoy):
- 2 plans: Simple apps — Free vs Premium
- 3 plans: MOST COMMON — Basic / Pro / Premium (with anchoring)
- 4+ plans: Only for distinct segments (Individual / Family / Business)

SUBSCRIPTION BENCHMARKS:
- Monthly vs Annual: Annual 20-40% cheaper, show as default with savings calculation
- Trial: 7-day standard, credit card upfront → 30% conversion (5x better)
- Free→Paid conversion: avg 2-5%, good 5-10%, great 15%+
- Trial→Paid: avg 30-40%, top apps 60%+
- Monthly churn: avg 9%, good <5%`;

const DEFAULT_PRICING_RULES = `CRITICAL PRICING RULES — PURCHASING POWER PARITY:
Prices MUST be adjusted per country based on local purchasing power. NEVER use flat currency conversion. Use these approximate tiers relative to US price (1.0x):
- Tier 1 (1.0x): US, CH, NO, AU, CA, GB, SE, DK, SG, JP, NZ, IE, DE, FR, NL, BE, AT, FI, IT, ES, KR, IL, AE, SA, HK
- Tier 2 (0.55x): PT, CZ, GR, SI, EE, HR, SK, LT, LV, TW, CL, MY, PL, HU, RO, BG, MX, BR, TH, ZA, TR, AR, CO, PE, PH
- Tier 3 (0.30x): IN, VN, EG, NG, ID, UA, KE, PK
Example: If US price = $4.99/week, then PL should be ~10.99 PLN (not 22 PLN), IN should be ~79 INR (not 400 INR).
Round prices to psychologically attractive values (.99, .49, whole numbers for large currencies like JPY, KRW, VND).
Each territory MUST have a DIFFERENT price appropriate to its purchasing power.

PRICING PSYCHOLOGY:
1. Anchoring: Show the most expensive option first — makes the middle one look reasonable
2. Charm pricing: $9.99 instead of $10.00 (psychologically "under 10")
3. Decoy effect: Add a "worse" option to make the target plan look better (e.g. 100 gems/$1.99 → 250/$3.99 → 600/$7.99)
4. Mental accounting: Convert to daily cost ("$0.33/day — cheaper than coffee")
5. Visual highlight: Mark the best option as "BEST VALUE" or "MOST POPULAR"
6. Annual push: Pre-select the annual option by default with 20-40% discount vs monthly
7. Loss aversion: Frame as loss — "Don't lose your progress" > "Buy more lives"
8. Rule of 100: Under $100 → percentages ("Save 40%"); over $100 → amounts ("Save $50")`;

const DEFAULT_CONVERSATION_GUIDELINES = `CONVERSATION GUIDELINES:
- You already have FULL context about the app and ALL its existing products (names, productIds, UUIDs, groups) in the EXISTING PRODUCTS section above. DO NOT ask the user for information that is already provided.
- When the user references a product by name or productId, IMMEDIATELY match it to the existing products list and act on it. Never ask "does this product exist?" or "what group does it belong to?" — you already know.
- Act decisively. Generate the monetization_plan block right away based on the user's instruction. Only ask questions if the user's request is genuinely ambiguous (e.g. they mention a product that doesn't exist at all).
- Explain briefly what you're doing, then output the plan block. Keep explanations short.

RED FLAGS — Automatically flag these issues if you notice them:
- No trial on subscription → "Add a 7-day trial — will increase conversion 2-5x"
- Single subscription plan → "Add 2-3 tiers with anchoring for higher revenue"
- Monthly only, no annual → "Add annual option with 20-40% discount"
- Price > 2x category median → "Price above benchmark — ensure strong value proposition"
- Price < 0.5x category median → "Consider raising price — below market average"
- No family plan for fitness/education/music → "Consider a family plan at 1.3-1.5x individual"
- 4+ subscription plans → "Too many options — simplify to 2-3 plans"
- Lifetime price < 2x annual → "Lifetime is cannibalizing subscriptions — raise to 5-8x annual"`;

const DEFAULT_MONETIZATION_PROMPTS: Record<MonetizationChatField, string> = {
	conversationGuidelines: DEFAULT_CONVERSATION_GUIDELINES,
	monetizationKnowledge: DEFAULT_MONETIZATION_KNOWLEDGE,
	monetizationRole: DEFAULT_MONETIZATION_ROLE,
	pricingRules: DEFAULT_PRICING_RULES,
};

// ── Default purchase field prompts ─────────────────────────────────────────

const DEFAULT_PURCHASE_PROMPTS: Record<
	PurchasePromptField,
	{ generate: string; rephrase: string }
> = {
	groupDescription: {
		generate: `You are an expert in mobile app monetization and App Store / Google Play in-app purchase optimization.
Write compelling, clear content. NEVER use emoji or special Unicode symbols.

You are writing a SUBSCRIPTION GROUP DESCRIPTION (max 45 characters).
This describes what the subscription group offers.
- Should summarize the value proposition of the group
- Complement the group name, do not repeat it
- Focus on what subscribers get access to`,
		rephrase: `You are an expert in mobile app monetization and App Store / Google Play in-app purchase optimization.
Write compelling, clear content. NEVER use emoji or special Unicode symbols.

You are rephrasing a SUBSCRIPTION GROUP DESCRIPTION (max 45 characters).
Improve the existing description for clarity and impact while keeping the same meaning.
- Complement the group name, do not repeat it
- Focus on the value proposition`,
	},
	groupName: {
		generate: `You are an expert in mobile app monetization and App Store / Google Play in-app purchase optimization.
Write compelling, clear content. NEVER use emoji or special Unicode symbols.

You are writing a SUBSCRIPTION GROUP NAME (max 30 characters).
This is the internal name for a group of related subscriptions.
- Should describe the tier or category of subscriptions
- Examples: "Premium Plans", "Pro Access", "Creator Tools"
- Keep it concise and descriptive`,
		rephrase: `You are an expert in mobile app monetization and App Store / Google Play in-app purchase optimization.
Write compelling, clear content. NEVER use emoji or special Unicode symbols.

You are rephrasing a SUBSCRIPTION GROUP NAME (max 30 characters).
Improve the existing name for clarity and appeal while keeping the same meaning.
- Should describe the tier or category
- Keep it concise and descriptive`,
	},
	productId: {
		generate: `You are an expert in mobile app monetization and App Store / Google Play in-app purchase optimization.
Write compelling, clear content. NEVER use emoji or special Unicode symbols.

You are generating a PRODUCT ID for an in-app purchase.
Product IDs use reverse-domain format: {bundleId}.{type}.{name}
- Must be lowercase
- Use dots or underscores as separators
- Should be descriptive and follow naming conventions
- Example: com.myapp.premium.monthly, com.myapp.coins.100`,
		rephrase: `You are an expert in mobile app monetization and App Store / Google Play in-app purchase optimization.
Write compelling, clear content. NEVER use emoji or special Unicode symbols.

You are improving a PRODUCT ID for an in-app purchase.
Product IDs use reverse-domain format: {bundleId}.{type}.{name}
- Must be lowercase
- Use dots or underscores as separators
- Make it more descriptive and consistent`,
	},
	purchaseDescription: {
		generate: `You are an expert in mobile app monetization and App Store / Google Play in-app purchase optimization.
Write compelling, clear content that clearly communicates value, passes store review guidelines, and uses benefit-focused language.
NEVER use emoji or special Unicode symbols.

You are writing an IN-APP PURCHASE DESCRIPTION (max 45 characters).
This appears below the purchase name in the purchase sheet.
- Must complement the name, NOT repeat it
- Focus on the key benefit or what the user unlocks
- Be specific about the value proposition`,
		rephrase: `You are an expert in mobile app monetization and App Store / Google Play in-app purchase optimization.
Write compelling, clear content. NEVER use emoji or special Unicode symbols.

You are rephrasing an IN-APP PURCHASE DESCRIPTION (max 45 characters).
Improve the existing description for better impact while keeping the same meaning.
- Must complement the name, NOT repeat it
- Focus on the key benefit or what the user unlocks`,
	},
	purchaseName: {
		generate: `You are an expert in mobile app monetization and App Store / Google Play in-app purchase optimization.
Write compelling, clear content that clearly communicates value, passes store review guidelines, and uses benefit-focused language.
NEVER use emoji or special Unicode symbols.

You are writing an IN-APP PURCHASE DISPLAY NAME (max 30 characters).
This is the name shown to users in the purchase sheet.
Formula: [Benefit] [Tier] or [Feature] [Level]
- Must clearly communicate what the user is buying
- Keep it short and scannable
- Do NOT use generic words like "subscription" or "purchase" unless necessary`,
		rephrase: `You are an expert in mobile app monetization and App Store / Google Play in-app purchase optimization.
Write compelling, clear content. NEVER use emoji or special Unicode symbols.

You are rephrasing an IN-APP PURCHASE DISPLAY NAME (max 30 characters).
Improve the existing name for better clarity and appeal while keeping the same meaning.
- Must clearly communicate what the user is buying
- Keep it short and scannable`,
	},
	reviewNotes: {
		generate: `You are an expert in mobile app monetization and App Store / Google Play in-app purchase optimization.
Write compelling, clear content. NEVER use emoji or special Unicode symbols.

You are writing REVIEW NOTES for App Store review team (max 4000 characters).
These notes help the App Store review team understand the in-app purchase.
- Explain what the purchase unlocks or provides
- Describe how to test the purchase flow
- Mention any demo accounts or test credentials if applicable
- Be clear and structured (use bullet points)
- This is NOT user-facing content — write for a reviewer`,
		rephrase: `You are an expert in mobile app monetization and App Store / Google Play in-app purchase optimization.
Write compelling, clear content. NEVER use emoji or special Unicode symbols.

You are improving REVIEW NOTES for App Store review team (max 4000 characters).
Improve the existing notes for clarity and completeness while keeping the same information.
- Explain what the purchase unlocks or provides
- Be clear and structured (use bullet points)
- This is NOT user-facing content — write for a reviewer`,
	},
};

// ── Getters ────────────────────────────────────────────────────────────────

export function getDefaultMonetizationPrompt(
	field: MonetizationChatField,
): string {
	return DEFAULT_MONETIZATION_PROMPTS[field];
}

export function getDefaultPurchasePrompt(
	field: PurchasePromptField,
	mode: PurchasePromptMode,
): string {
	return DEFAULT_PURCHASE_PROMPTS[field][mode];
}

export function getAllDefaultMonetizationPrompts(): Record<string, string> {
	const defaults: Record<string, string> = {};
	for (const { key } of MONETIZATION_CHAT_FIELDS) {
		const settingKey = getMonetizationSettingKey(key);
		defaults[settingKey] = getDefaultMonetizationPrompt(key);
	}
	return defaults;
}

export function getAllDefaultPurchasePrompts(): Record<string, string> {
	const defaults: Record<string, string> = {};
	for (const { key } of PURCHASE_FIELDS) {
		for (const mode of PURCHASE_PROMPT_MODES) {
			const settingKey = getPurchaseSettingKey(key, mode);
			defaults[settingKey] = getDefaultPurchasePrompt(key, mode);
		}
	}
	return defaults;
}

// ── Guide content ──────────────────────────────────────────────────────────

export interface GuideSection {
	content: string;
	id: string;
	title: string;
}

export const MONETIZATION_GUIDE_SECTIONS: GuideSection[] = [
	{
		content: `| Model | Description | Best For | Revenue Split |
|-------|-------------|----------|---------------|
| **Freemium** | Free base + paid premium | Productivity, fitness, social | 15-30% commission |
| **Subscriptions** | Recurring payments (monthly/annual) | Content, fitness, productivity, education | 15% after 1st year |
| **One-time Purchase** | Buy once, own forever | Tools, photo filters, premium games | 30% commission |
| **In-App Purchases** | Purchases within the app | Games, social, lifestyle | 30% (15% for small devs) |
| **Ads** | Banners, interstitials, rewarded | Casual games, utility, news | Depends on ad network |
| **Hybrid** | Mix of 2+ models | 60%+ top-grossing apps | Depends on mix |
| **Paywall** | Hard/soft content blocking | Media, education, SaaS | 15-30% commission |

**2026 Trend:** Over 60% of top-grossing apps use multiple revenue streams simultaneously (e.g., subscription + consumables + rewarded ads).`,
		id: "models",
		title: "Monetization Models",
	},
	{
		content: `| Category | Primary Model | Alternative | Notes |
|----------|--------------|-------------|-------|
| Games — Casual | IAP consumables + Ads | Battle Pass | Anchor pricing on biggest gem pack |
| Games — Strategy/RPG | IAP + Season Pass | VIP Sub | Watch out for gacha regulations |
| Productivity | Freemium + Sub | One-time unlock | Tier pricing (Personal/Pro/Team) |
| Health & Fitness | Sub monthly/annual | Freemium + IAP | 7-day trial with credit card |
| Education | Freemium + Sub | IAP (courses) | Duolingo model reference |
| Photo & Video | Freemium + Sub | One-time filters | Short trial (3 days) |
| Social Networking | Freemium + IAP | Sub (premium tier) | Cosmetics, badges, boosts |
| Finance | Freemium + Premium | Sub | Trust = key, no aggressive tactics |
| News / Magazines | Paywall + Sub | Ads (free tier) | Metered paywall works best |
| Music | Sub | Ads (free tier) | Spotify model |
| Travel | Sub / IAP | Affiliate | Highest trial→paid conversion |
| Business / SaaS | Sub (tiers) | Per-seat pricing | Highest download→trial (8.9%) |
| Utilities | One-time / Freemium | Ads | "Remove ads" as primary IAP |

**Decision tree:** Does the app deliver continuous value? → Subscription. Is it a tool? → One-time purchase. Internal economy? → Consumable IAP. Social/community? → Freemium + IAP.`,
		id: "category-matrix",
		title: "Category → Strategy Matrix",
	},
	{
		content: `**Golden Rule: 3 Plans with a Decoy**

| Plan | Example Price | Purpose |
|------|--------------|---------|
| Basic | $4.99/mo | Entry point, limited features |
| Pro | $9.99/mo | **TARGET** — "MOST POPULAR" tag |
| Premium | $14.99/mo | Everything + exclusives, makes Pro look reasonable |

**Pricing Techniques:**
- **Anchoring** — Show the most expensive option first; middle tier looks like a deal
- **Charm pricing** — $9.99 instead of $10.00 (psychologically "under 10")
- **Decoy effect** — Add a "worse" option to push users to the target plan
- **Mental accounting** — "$0.33/day — cheaper than coffee"
- **Annual push** — Pre-select annual with 20-40% savings vs monthly
- **Loss aversion** — "Don't lose your progress" > "Buy more lives"

**PPP (Purchasing Power Parity):**
- Tier 1 (1.0x): US, GB, DE, FR, JP, AU, CA, etc.
- Tier 2 (0.55x): PL, BR, MX, TH, ZA, TR, etc.
- Tier 3 (0.30x): IN, VN, EG, NG, ID, PK, etc.
- Never flat-convert USD → local currency — adjust for purchasing power

**Benchmarks:**
- Free trial + credit card → 30% conversion (5x better than without)
- 3-plan paywall → highest conversion vs 2 or 4+ plans
- Annual pre-selected → +30% revenue`,
		id: "pricing",
		title: "Pricing Best Practices",
	},
	{
		content: `| Trial Length | Cancellation Rate | Conversion | Best For |
|-------------|-------------------|------------|----------|
| 3 days | 26% | High (filters non-serious) | Simple apps, utility |
| 7 days | ~35% | Good | **Standard for most apps** |
| 14 days | ~42% | Medium | Apps requiring onboarding |
| 30 days | 51% | ~48.8% (but half cancel) | B2B, complex tools |

**Optimal Trial Design:**
- **Length:** 7 days (standard), 3 days (simple), 14 days (complex B2B)
- **Credit card upfront:** YES = 30% conversion, NO = 5-6%
- **What to unlock:** 100% premium during trial — let users feel the full value
- **Notifications:** Day 1: "Welcome!", Day 5: "2 days left", Day 7: "Your trial ends today"
- **Onboarding:** Actively showcase premium features during trial

**Trial Anti-patterns:**
- Don't limit trial to 1 day (too short to see value)
- Don't hide the trial end date (trust issue)
- Don't block features during trial (defeats the purpose)
- Don't spam notifications during trial

**Introductory Offers (App Store Connect):**
- Free trial: 3/7/14/30 days free
- Pay-up-front: Discounted price for first period ($0.99 for first month)
- Pay-as-you-go: Discounted price for X periods ($4.99 instead of $9.99 for 3 months)`,
		id: "trials",
		title: "Trial Optimization",
	},
	{
		content: `These issues should be flagged automatically during monetization planning:

| Red Flag | Condition | Recommendation |
|----------|-----------|---------------|
| No trial | Subscription without any trial | Add a 7-day trial — increases conversion 2-5x |
| Single plan | Only 1 subscription option | Add 2-3 tiers with anchoring for higher revenue |
| Monthly only | No annual option available | Add annual with 20-40% discount |
| Too expensive | Price > 2x category median | Ensure strong value proposition or lower price |
| Too cheap | Price < 0.5x category median | Consider raising — below market average |
| No family plan | Fitness/education/music without family option | Add family plan at 1.3-1.5x individual price |
| Too many plans | More than 4 subscriptions | Simplify to 2-3 plans — choice overload |
| No introductory offer | No promo/intro offer set up | Add introductory offer in App Store Connect |
| Lifetime too cheap | Lifetime price < 2x annual | Raise to 5-8x annual — currently cannibalizing subs |
| No free tier | Paid app with low downloads/rating | Consider freemium with feature paywall |

**What to Keep Free (80/20 Rule):**
- Core functionality, onboarding, minimum viable experience

**What to Block (Premium):**
- Unlimited usage, advanced tools, AI features, personalization, ad-free experience, offline mode`,
		id: "red-flags",
		title: "Red Flags & Warnings",
	},
];

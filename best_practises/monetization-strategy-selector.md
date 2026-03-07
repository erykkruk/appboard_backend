# Monetization — Strategy Selector Based on App Description

> This file serves as a **decision framework** for AI in AppBoard.
> Based on app description, category, and user data — suggest a monetization strategy.

---

## 1. How to Suggest Monetization — Framework

### Input: What We Know About the App

When a user adds an app to AppBoard, we collect:

| Field | Source | Example |
|-------|--------|---------|
| **Name** | App Store / Google Play | "FitTracker Pro" |
| **Category** | Store metadata | Health & Fitness |
| **Description** | Store listing | "Track workouts, meals, and sleep..." |
| **Current IAP** | Store API (purchases) | Monthly $9.99, Annual $59.99 |
| **Price** | Store metadata | Free / $4.99 |
| **Rating** | Store metadata | 4.6 (12K reviews) |
| **Size** | Store metadata | Downloads estimate |

### Output: What We Recommend

Based on the above data, we generate:

1. **Recommended monetization model** (with explanation)
2. **Suggested pricing structure** (plans + prices)
3. **Comparison with category benchmarks**
4. **Quick-win tips** (3-5 specific actions)
5. **Warnings** (if current strategy has red flags)

---

## 2. Selection Algorithm — Category → Strategy Matrix

### Step 1: Identify the Value Type

```
From the app description, extract:

1. Does the app deliver CONTINUOUS content/value?
   - "daily workouts", "weekly challenges", "new content"
   - "streaming", "lessons", "courses"
   → Signal: SUBSCRIPTION

2. Is the app a TOOL?
   - "calculator", "scanner", "converter", "editor"
   - "one-time", "professional tool"
   → Signal: ONE-TIME PURCHASE

3. Does the app have an INTERNAL ECONOMY?
   - "coins", "gems", "credits", "lives", "energy"
   - "boosters", "power-ups", "packs"
   → Signal: CONSUMABLE IAP

4. Does the app have a SOCIAL/COMMUNITY aspect?
   - "profile", "followers", "messages", "groups"
   - "premium badge", "exclusive features"
   → Signal: FREEMIUM + IAP (cosmetics/premium)

5. Does the app have MANY users but LOW revenue?
   - Free app, no IAP, high downloads
   → Signal: ADS + optional premium (remove ads)
```

### Step 2: Map Category to Default Strategy

| Category (App Store) | Default Strategy | Alternative | Notes |
|-----------------------|-----------------|-------------|-------|
| Games — Casual | IAP consumables + Rewarded Ads | Battle Pass | Anchor pricing on biggest gem pack |
| Games — Strategy/RPG | IAP + Season Pass | VIP Sub | Gacha / lootbox (watch out for regulations!) |
| Games — Premium | One-time $4.99-$9.99 | DLC packs | Rare but loyal audience |
| Health & Fitness | Sub monthly/annual | Freemium + IAP | 7-day trial with credit card |
| Education | Freemium + Sub | IAP (courses) | Duolingo model reference |
| Productivity | Freemium + Sub | One-time unlock | Tier pricing (Personal/Pro/Team) |
| Photo & Video | Freemium + Sub | One-time filters | Short trial (3 days) |
| Music | Sub | Ads (free tier) | Spotify model |
| Social Networking | Freemium + IAP | Sub (premium tier) | Cosmetics, badges, boosts |
| News / Magazines | Paywall + Sub | Ads (free tier) | Metered paywall works best |
| Finance | Freemium + Premium | Sub | Trust = key, no aggressive tactics |
| Travel | Sub / IAP | Affiliate | Highest trial→paid conversion! |
| Food & Drink | Sub + Ads | IAP (recipes) | Seasonal content drives retention |
| Utilities | One-time / Freemium | Ads | "Remove ads" as primary IAP |
| Weather | Freemium + Ads | Sub (premium forecasts) | Rewarded video works well |
| Entertainment | Sub | Ads + IAP | Content library model |
| Shopping | Free + Affiliate | Premium features | Monetize via partnerships |
| Lifestyle | Freemium + Sub | IAP | Personalization as premium |
| Medical | Sub / One-time | B2B licensing | Regulations! Conservative approach |
| Kids | One-time | Sub (parental) | COPPA/GDPR-K compliance required |
| Books | Sub / IAP (per book) | Ads | Kindle Unlimited model |
| Sports | Sub | Ads + IAP | Live content drives sub value |
| Navigation | Freemium + Sub | Ads | Offline maps as premium |
| Developer Tools | Sub (tiers) | One-time | B2B pricing ok |
| Business | Sub (tiers) | Per-seat pricing | Highest download→trial (8.9%) |
| Reference | One-time / Freemium | Ads | Users expect a one-time payment |

### Step 3: Analyze Current Purchases

If the app already has store purchases, analyze:

```
Current IAP → Assessment:

1. How many subscription plans?
   - 1 plan → "Consider adding 2-3 tiers (anchoring)"
   - 2-3 plans → "Good structure, check pricing gaps"
   - 4+ plans → "Too many — simplify to 3 plans"

2. Is there a trial?
   - No trial → "Add a 7-day trial — will increase conversion by 2-5x"
   - Trial < 3 days → "Too short — consider 7 days"
   - Trial > 14 days → "Too long for this category — 51% cancellation rate"

3. Price vs category benchmark?
   - Below median → "Raising price by $1-2 could increase revenue"
   - Above median → "Make sure value proposition is clear"

4. Annual vs Monthly?
   - Monthly only → "Add annual with 20-40% discount"
   - Annual only → "Add monthly as entry point"
   - Both → "Check if annual is pre-selected by default"

5. Family plan?
   - None → If category is fitness/education/music → "Consider a family plan"
```

---

## 3. Recommendation Template — What AI Generates

### Template: Monetization Analysis

```markdown
## Monetization Analysis: {App Name}

### Current Situation
- **Model:** {Free / Paid $X / Freemium}
- **Subscriptions:** {list of plans with prices}
- **IAP:** {list of purchases}
- **Trial:** {Yes/No, length}

### Recommended Model
Based on the **{Category}** category and app description, we recommend:
**{Model}** — {1-2 sentence explanation}

### Suggested Pricing Structure
| Plan | Monthly Price | Annual Price | Features |
|------|-------------|-------------|----------|
| {Basic} | ${X} | ${Y} | {list} |
| {Pro} | ${X} | ${Y} ← Best Value | {list} |
| {Premium} | ${X} | ${Y} | {list} |

### Category Benchmarks
- Average subscription price in **{Category}**: ${X}/mo
- Free-to-paid conversion benchmark: {X}%
- Trial→Paid benchmark: {X}%

### Quick-Win Tips
1. {Tip 1 — specific action}
2. {Tip 2 — specific action}
3. {Tip 3 — specific action}

### Warnings
⚠️ {Red flag if exists, e.g., "No trial — you're losing potential subscribers"}
```

---

## 4. Pricing Benchmarks per Category (2026)

> Use this data to compare app prices with category medians.

| Category | Median Monthly Sub | Median Annual Sub | Typical Trial | Conv. Benchmark |
|----------|-------------------|-------------------|--------------|-----------------|
| Health & Fitness | $9.99 | $49.99-$79.99 | 7 days | 5-8% |
| Education | $9.99-$14.99 | $59.99-$99.99 | 7 days | 4-7% |
| Productivity | $4.99-$9.99 | $29.99-$59.99 | 7 days | 6-10% |
| Photo & Video | $4.99-$7.99 | $29.99-$49.99 | 3 days | 3-6% |
| Music | $9.99 | $99.99 | 30 days | 4-6% |
| News | $9.99-$14.99 | $49.99-$99.99 | 30 days | 3-5% |
| Finance | $4.99-$9.99 | $39.99-$79.99 | 7 days | 5-8% |
| Dating | $14.99-$29.99 | $99.99-$199.99 | 7 days | 3-5% |
| Weather | $0.99-$4.99 | $9.99-$29.99 | 7 days | 4-7% |
| Business / SaaS | $9.99-$29.99 | $79.99-$199.99 | 14 days | 8-12% |
| Travel | $4.99-$9.99 | $29.99-$59.99 | 7 days | 7-10% |
| Games (sub/pass) | $4.99-$9.99 | $29.99-$49.99 | 3 days | 2-5% |

---

## 5. Red Flags — Automatic Warnings

AI should automatically flag these issues:

| Red Flag | Condition | Recommendation |
|----------|-----------|---------------|
| No trial | App has sub but zero trial | "Add a 7-day trial" |
| Single plan | Only 1 subscription | "Add 2-3 tiers with anchoring" |
| Monthly only | No annual option | "Add annual with 20-40% discount" |
| Too expensive vs category | Price > 2x category median | "Price above benchmark — ensure strong value proposition" |
| Too cheap | Price < 0.5x median | "Price below benchmark — consider raising" |
| No family plan | Category fitness/edu/music + no family | "Consider a family plan" |
| Too many plans | >4 subscriptions | "Too many options — simplify to 2-3" |
| No introductory offer | No promo/intro offer | "Add an introductory offer in ASC" |
| Lifetime too cheap | Lifetime < 2x annual | "Lifetime is cannibalizing subscriptions" |
| No free tier | Paid app + low rating + few downloads | "Consider freemium with paywall" |

---

## Sources

- [Adapty — App Pricing Models 2026](https://adapty.io/blog/app-pricing-models/)
- [FunnelFox — App Pricing Models Guide](https://blog.funnelfox.com/app-pricing-models-guide/)
- [RevenueCat — Lifetime Subscriptions Guide](https://www.revenuecat.com/blog/growth/lifetime-subscriptions/)
- [Business of Apps — LTV App Rates 2026](https://www.businessofapps.com/data/ltv-app-rates/)
- [Plotline — Top Mobile App Monetization Strategies 2026](https://www.plotline.so/blog/mobile-app-monetization-strategies)
- [Crossway Consulting — IAP Earning Trends 2026](https://www.crosswayconsulting.com/in-app-purchase-earning-trends-in-2026-app-monetization-guide/)

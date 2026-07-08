# Monetization — Purchases Tips (5 Key Tips)

> The 5 most important tips for the Purchases section in AppBoard.
> When a user clicks on Purchases, display these tips as quick-wins.
> Each tip is self-contained — to be expanded in the future.

---

## Tip 1: Match the Pricing Model to Your Category — Don't Blindly Copy Competitors

**Problem:** Developers often copy monetization models from popular apps without understanding why that model works for that specific category.

**Rule:**
- **Continuous value** (fitness, education, content) → **Subscription**
- **One-time value** (tools, photo filters) → **One-time purchase**
- **Internal economy** (games, social) → **IAP consumables**
- **Mix** (productivity, SaaS) → **Freemium + subscription tiers**

**Quick check:** Answer the question: *"Is my app more like Netflix (continuous content) or Procreate (a tool)?"*

| Question | YES → | NO → |
|----------|-------|------|
| Do I regularly deliver new content? | Subscription | One-time / IAP |
| Does the user engage daily? | Subscription | IAP / One-time |
| Does the app have an internal currency? | Consumable IAP | Non-consumable / Sub |
| Does core value require a server? | Subscription (cover your costs) | One-time purchase |

**Benchmark:** 60%+ top-grossing apps use a **hybrid model** (min. 2 revenue streams). Don't be afraid to mix.

---

## Tip 2: Plan Your Pricing with Anchoring and the Decoy Effect

**Problem:** Developers throw in a single price and hope for conversions. Lack of pricing strategy is money left on the table.

**Golden rule: 3 plans with a decoy**

```
Plan A (Basic):    $4.99/mo   — limited features
Plan B (Pro):      $9.99/mo   — "MOST POPULAR" ← target
Plan C (Premium):  $14.99/mo  — everything + exclusives

Annual pricing with anchoring:
Monthly: $9.99/mo  = $119.88/yr  ← show this price
Annual:  $5.99/mo  = $71.88/yr   ← "Save 40%!"
```

**Pricing techniques to apply:**

1. **Anchoring:** Always show the most expensive option first — makes the middle one look reasonable
2. **Charm pricing:** $9.99 instead of $10.00 (psychologically "under 10")
3. **Mental accounting:** Convert to daily cost ("$0.33/day — cheaper than coffee")
4. **Visual highlight:** Mark the best option as "BEST VALUE" or "MOST POPULAR"
5. **Annual push:** Pre-select the annual option by default — 20-40% discount vs monthly

**Benchmark:**
- Free trial with credit card → **30% conversion** (5x better than without card)
- 7-day trial → optimal for most categories
- 3-plan paywall → **highest conversion** compared to 2 or 4+ plans

---

## Tip 3: Don't Block Core Value Behind a Paywall — Block "Superpowers"

**Problem:** Blocking key features behind a paywall prevents users from even understanding the app's value, leading to uninstalls. On the other hand, giving away too much for free kills conversion.

**The 80/20 Rule:**
- **80% core experience for free** — user must feel the value
- **20% "superpowers" behind paywall** — advanced, time-saving, personalization

**Keep free:**
- Core functionality (core loop)
- Onboarding and tutorial
- Minimum viable experience (first 3-5 sessions)

**Block (premium):**
- Unlimited usage (storage, projects, exports)
- Advanced tools (AI features, analytics, batch operations)
- Personalization (custom themes, profiles)
- Ad-free experience
- Priority support
- Offline mode / export

**Paywall timing:**
- Don't show paywall during onboarding (unless strong brand)
- Show after **3-5 sessions** — user knows the value
- Show at the **"aha moment"** — when user needs a premium feature
- **Never** random pop-up with paywall

**Benchmark:** Apps with soft paywall (feature-gated) have **2-3x better retention** than hard paywall.

---

## Tip 4: Design a Trial That Converts — Not One That Scares Users Away

**Problem:** A poorly designed trial is either "too short to understand the value" or "too long and the user forgets about payment".

**Optimal trial design:**

| Element | Recommendation |
|---------|---------------|
| **Length** | 7 days (standard), 3 days (simple apps), 14 days (complex B2B) |
| **Credit card upfront?** | YES = 30% conversion, NO = 5-6% conversion |
| **What to unlock** | 100% premium during trial — let user feel the full value |
| **Notifications** | Day 1: "Welcome!", Day 5: "2 days left", Day 7: "Your trial ends today" |
| **Onboarding** | Actively showcase premium features — don't wait for user to discover them |

**Trial anti-patterns:**
- Don't limit trial to 1 day (too short)
- Don't hide the trial end date (trust issue)
- Don't block features during trial (that's not a trial!)
- Don't spam notifications during trial

**Pro tip — Introductory Offers (App Store Connect):**
- **Free trial:** 3/7/14/30 days free
- **Pay-up-front:** Discounted price for first period ($0.99 for first month)
- **Pay-as-you-go:** Discounted price for X periods ($4.99 instead of $9.99 for 3 months)

**Benchmark:**
- 7-day trial + credit card upfront = **best combination** for most apps
- Trial → Paid conversion: average **30-40%**, top apps **60%+**

---

## Tip 5: Measure, Test, Iterate — Monetization Is a Process, Not a One-Time Decision

**Problem:** Developers set a price at launch and never change it. Monetization is a living organism.

**What to measure (key metrics):**

| Metric | What It Tells You | Target |
|--------|-------------------|--------|
| **Free → Paid conversion** | Is the paywall working | 5-10% |
| **Trial → Paid conversion** | Is the trial converting | 30-50% |
| **ARPU** | Revenue per user (all users) | $1-5/mo |
| **ARPPU** | Revenue per paying user | $10-30/mo |
| **Monthly churn** | How many users are leaving | <5% |
| **LTV** | Lifetime value of a user | >3x CAC |
| **Paywall impression → purchase** | Paywall effectiveness | 10-20% |

**What to A/B test:**

1. **Prices** — $9.99 vs $7.99 vs $12.99 (measure revenue, not conversion!)
2. **Trial length** — 3 vs 7 vs 14 days
3. **Paywall design** — layout, copy, CTA text, social proof
4. **Paywall timing** — after 1st session vs after 3rd session vs at "aha moment"
5. **Plan structure** — 2 plans vs 3 plans
6. **Annual vs monthly** — default selection

**Iteration cadence:**
- Test **1 change at a time** (isolate the variable)
- Min. **1,000 impressions** before making a decision
- Analyze after **2-4 weeks** (not after 2 days)
- Measure **LTV**, not just conversion (higher price = lower conversion, but higher revenue)

**Pro tip — Win-back:**
- Promotional offers for lapsed subscribers (App Store Connect)
- "We miss you — come back for $1.99/mo (instead of $9.99)" → **10-20% recovery rate**

---

## Quick Reference — 5 Tips at a Glance

| # | Tip | One-Sentence Summary |
|---|-----|---------------------|
| 1 | Match model to category | Subscription for continuous value, IAP for games, one-time for tools |
| 2 | Pricing with anchoring | 3 plans, decoy effect, annual as default, charm pricing |
| 3 | Don't block core value | 80% free, 20% premium — block superpowers, not basics |
| 4 | Trial that converts | 7 days + credit card, 100% features, smart notifications |
| 5 | Measure and iterate | A/B test prices, timing, design — LTV > conversion |

---

## Read More

Each tip will be expanded in a separate file in the future:
- `monetization-tip1-model-selection.md` — detailed model selection framework
- `monetization-tip2-pricing-strategy.md` — advanced pricing psychology
- `monetization-tip3-paywall-design.md` — paywall design with examples
- `monetization-tip4-trial-optimization.md` — trial optimization + App Store Connect setup
- `monetization-tip5-analytics-testing.md` — metrics, A/B tests, cohort analysis

---

## Sources

- [Adapty — App Pricing Models 2026](https://adapty.io/blog/app-pricing-models/)
- [RevenueCat — Trial Conversion Insights](https://www.revenuecat.com/blog/growth/app-trial-conversion-rate-insights/)
- [FunnelFox — App Pricing Models Guide](https://blog.funnelfox.com/app-pricing-models-guide/)
- [Adapty — Subscription Trends 2026](https://adapty.io/blog/9-subscription-trends-dominating-2025/)
- [MoldStud — 5 Monetization Mistakes](https://moldstud.com/articles/p-5-common-app-monetization-mistakes-and-how-to-avoid-them)

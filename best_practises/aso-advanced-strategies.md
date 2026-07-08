# ASO — Advanced strategies and deep dive (2026)

> Extended research: ranking algorithms, Custom Product Pages, In-App Events, seasonality, competitor analysis, Apple Search Ads synergy, retention, icons.

---

## Table of contents

1. [Ranking algorithm — how it really works](#1-ranking-algorithm)
2. [Retention and user quality](#2-retention-and-user-quality)
3. [Custom Product Pages & Custom Store Listings](#3-custom-product-pages)
4. [In-App Events & Promotional Content](#4-in-app-events--promotional-content)
5. [Apple Search Ads + ASO Synergy](#5-apple-search-ads--aso-synergy)
6. [Competitor analysis — deep dive](#6-competitor-analysis)
7. [Seasonal ASO — calendar and tactics](#7-seasonal-aso)
8. [App icon — advanced design](#8-app-icon)
9. [Rating Prompt Strategy](#9-rating-prompt-strategy)
10. [ASO tools](#10-aso-tools)

---

## 1. Ranking algorithm

### Apple App Store — ranking factors (decreasing weight):

| Factor | Weight | Description |
|---------|------|-------------|
| **Title + Subtitle** | Highest | The most heavily weighted text fields for keyword relevance |
| **Keyword Field** | High | 100 characters, complements title/subtitle |
| **Download Velocity** | High | Download speed over time — a strong signal |
| **Conversion Rate** | High | % of impressions → install |
| **Retention D7/D30** | High | Day-7 and day-30 retention — **greater weight than CTR** |
| **Ratings and reviews** | High | Below 3.5★ = "significantly reduced visibility"; 4.0+ correlates with better ranking |
| **Uninstall rate** | High | Fast uninstall = negative impact **stronger than a low rating** |
| **Session length / DAU** | Medium | Session length, daily active users |
| **Crash rate** | Medium | Unstable releases → lower ratings → lower conversion → lower ranking |
| **Update frequency** | Medium | Regular updates (every 2-4 weeks) signal active development |
| **In-App Events** | Low-Medium | Indexed in search, extra visibility |
| **Screenshot captions** | New! | Some screenshot captions are now factored into ranking |
| **Revenue** | Indirect | Impact through engagement metrics |

### Google Play — ranking factors:

| Factor | Weight | Difference vs iOS |
|---------|------|---------------|
| **Title** | Highest | Same as iOS |
| **Short description** | High | iOS doesn't have this field |
| **Long description** | Medium | **Indexed** (iOS does NOT index the description!) |
| **Download velocity** | High | Same |
| **Ratings and reviews** | High | Sentiment analysis, review velocity |
| **Retention / engagement** | High | DAU, session freq/length, uninstall rate |
| **Android Vitals** | High | Crash rate, ANR rate, battery, load time — **penalty for poor results** |
| **Backlinks** | Low | Google indexes links to the listing from the web |
| **Localization** | Medium | Localized apps get a boost in the given region |
| **Update frequency** | Medium | Regular updates = positive signal |

### Key insight 2026:

> **Ranking in 2026 is less about "who stuffs keywords best" and more about "who proves at scale that real users want the app, like it, and keep it."**

### Priority hierarchy (from most important):
```
1. Product (retention, engagement, quality)
2. Metadata (title, keywords, description)
3. Conversion (screenshots, icon, description)
4. Volume (downloads, velocity)
5. Social proof (ratings, reviews)
6. External signals (ads, editorial, links)
```

---

## 2. Retention and user quality

### Why retention matters more now than ever:

- **Retention D7/D30 carries greater weight than CTR** in the algorithm
- Fast uninstall has a **more negative impact than a low star rating**
- Stores reward apps that users **keep and use**

### Retention metrics affecting ranking:

| Metric | Description | Impact |
|---------|------|-------|
| **D1 Retention** | % of users returning after 1 day | Early quality signal |
| **D7 Retention** | % after 7 days | Strong signal — higher than CTR |
| **D30 Retention** | % after 30 days | Key long-term signal |
| **Session frequency** | How often they open the app | Engagement metric |
| **Session length** | How long they spend in the app | Engagement |
| **Uninstall rate** | % of uninstalls after install | Negative signal |
| **Churn rate** | % of users leaving in a given period | Trend quality |

### What this means for ASO:

1. **Don't generate fake installs** — bots/incentivized installs → fast uninstall → penalty
2. **Target the right users** — CPP/CSL matched to intent → better product-market fit → better retention
3. **Don't promise in the listing what you don't deliver** — expectation mismatch → uninstall → ranking drop
4. **Onboarding is part of ASO** — good onboarding → better retention → better ranking
5. **Monitor Android Vitals** — crash rate, ANR, battery → penalty for poor results

### Feedback loop:
```
Better listing → Right users → Better retention → Higher ranking → More visibility → More of the right users
```

---

## 3. Custom Product Pages

### Apple — Custom Product Pages (CPP):

| Element | Details |
|---------|-----------|
| **Max count** | 70 CPPs per app (increased from 35, October 2025) |
| **What you can customize** | Screenshots, video, promotional text, deep links |
| **What you CANNOT change** | Title, description, icon (fixed from the default page) |
| **Localization** | Full per region |
| **Organic search** | As of July 2025 — CPPs appear in **organic** search results! |

### Breakthrough 2025 — CPP in organic search:

- Assign keywords from the keyword field to specific CPPs
- When the app ranks for those keywords, the CPP can **replace the default page** in results
- Each keyword combination must be **unique** to one CPP
- App Store Connect shows search impressions per CPP

### Strategic use cases:

| Strategy | Example |
|-----------|---------|
| **Feature-based** | Design app: separate CPP for "photo editor", "background remover", "AI filters" |
| **Audience-based** | Fitness: CPP for "strength training" (men), CPP for "yoga" (women) |
| **Language-based** | Language-learning app: CPP with images of Paris landmarks for "learn French" |
| **Seasonal** | Black Friday CPP with promotions in the first screenshot |
| **Campaign-aligned** | CPP matched to ad creatives (Facebook → CPP with the same messaging) |

### Performance:

| Segment | Conversion lift |
|---------|-----------------|
| Games | +8% CVR |
| Non-gaming | +6.6% CVR |
| Generic campaigns | up to +8.6% CVR |
| SoundCloud (keyword campaigns) | **+58% CVR**, -39% CPI |
| CBS Sports | +20% conversion |

### Google Play — Custom Store Listings (CSL):

| Element | Details |
|---------|-----------|
| **Max count** | 50 CSLs |
| **What you can customize** | Title, description, icon, screenshots, video — **more than Apple!** |
| **Deep links** | Only work for users who already have the app installed |
| **Targeting** | Country, UTM source, installed state |

### CPP/CSL best practices:

1. **Ad → CPP alignment** — the ad's messaging must match the CPP, otherwise drop-off after the click
2. **The first screenshot = most important** — often the only thing the user sees
3. **One clear CTA** — not several on one page
4. **Test systematically** — one variant at a time
5. **Don't create a CPP for every minor feature** — focus on high-impact variants
6. **Cross-team collaboration** — ASO + UA + creative must work together

---

## 4. In-App Events & Promotional Content

### Apple — In-App Events:

**Event types (badges):**

| Badge | Description | Example |
|-------|------|---------|
| Challenge | Goal to reach within a timeframe | "30-day fitness challenge" |
| Competition | Competing with others | "Weekly leaderboard" |
| Live Event | Real-time experience | "Live Q&A with CEO" |
| Major Update | Significant new feature | "AI-powered search is here" |
| New Season | New content cycle | "Season 3 available now" |
| Premiere | Content premiere | "New course: Advanced ASO" |
| Special Event | Other unique moments | "Anniversary celebration" |

**Limits and requirements:**

| Element | Limit |
|---------|-------|
| Max approved events | 15 |
| Max live simultaneously | 10 |
| Duration | 15 min – 31 days |
| Publish before start | Up to 14 days |
| Event Name | max 30 characters (searchable!) |
| Short Description | max 50 characters |
| Long Description | max 120 characters |

**Graphic requirements:**

| Element | Size | Format |
|---------|---------|--------|
| Event Card | 1920×1080 (16:9, landscape) | JPG/PNG/Video |
| Details Page | 1080×1920 (9:16, portrait) | JPG/PNG/Video |

**Where they appear:**
- On the product page
- **In search results** (below the listing — the app appears twice!)
- Today tab, Apps tab, Games tab (editorially curated)

**Apple rejects events that:**
- Promote ongoing/recurring activities
- Focus solely on a discount without new content
- Have a generic/unclear description

### Google Play — Promotional Content (LiveOps):

**Types:**

| Type | Description | Requirement |
|-----|------|----------|
| Offers | Discounts, bundles, free rewards, trial | Min 10% value |
| Time-Limited Events | Contests, challenges, live stream | Time-limited |
| Major Updates | New features, expansions | Significant changes |

**Requirements:**

| Element | Limit |
|---------|-------|
| Tagline | max 80 characters |
| Description | max 500 characters |
| Image | 1920×1080 (16:9), JPG/PNG |
| Video | YouTube link, landscape |
| Approval time | min 4 days |
| Featuring request | 14-30 days ahead |

**Targeting:**
- Everyone (existing + potential)
- Potential users only
- Specific segments (churned, lapsed, buyers)

**Results per Google:**
- **+2% MAU** (monthly active users)
- **+4% revenue** vs developers without promotional content

### Event strategy:

1. **Plan 2-3 months ahead** — especially for major seasons
2. **Localize metadata** — Apple does NOT translate automatically
3. **Deep links must work** — test before submission
4. **Specific, action-oriented descriptions** — not "Something exciting is coming"
5. **Align with the season** — events matched to the seasonal calendar
6. **Refresh regularly** — a new event every 2 weeks = continuous visibility

---

## 5. Apple Search Ads + ASO Synergy

### Growth Loop:

```
ASO (organic visibility)
  ↓ better metadata → higher Quality Score in Ads
  ↓ lower CPT (cost per tap)
Apple Search Ads (paid)
  ↓ increased installs → higher download velocity
  ↓ better organic ranking
ASO (higher organic ranking)
  ↓ more organic installs
  → FEEDBACK LOOP
```

### How Ads help ASO:

| Mechanism | Description |
|-----------|------|
| **Keyword discovery** | Ads Discovery campaigns reveal high-converting keywords → add to metadata |
| **Download velocity** | Paid installs increase velocity → boost organic ranking |
| **Conversion data** | Ads show which keywords convert → optimize metadata |
| **Quality Score** | Good ASO → higher relevance score → lower CPT in Ads |
| **CPP integration** | Connect Ad Groups with a specific CPP for message alignment |

### Google Ads Campaigns:
- **Google App Campaigns** automate promotion across Google Search, YouTube, Google Play and the Display Network
- Machine learning optimizes bidding based on app store listings
- Less granular control over keywords than Apple Ads
- Complementary to ASO — consistent messaging and creatives across both channels

### Change March 2026:

> Apple is expanding the number of ad slots in App Store search results — multiple paid ads will appear **throughout the results**, not just at the top.

**Implications:**
- More competition between paid and organic
- Strategic coordination of ASO + Ads required
- Monitor share of voice (SOV) organic vs paid
- Budget allocation must account for both channels

### Synergy strategy:

1. **Discovery Campaign** → collect keyword data → update ASO metadata
2. **Exact Match Campaign** → target top keywords from ASO → boost velocity
3. **Brand Defense** → bid on your own brand → block competitors
4. **Competitor Keywords** → bid on competitors' keywords + matched CPP
5. **CPP + Ad Groups** → each ad group → dedicated CPP → aligned messaging

---

## 6. Competitor analysis

### Competitor analysis framework:

#### Step 1: Identify competitors

| Type | How to find |
|-----|-------------|
| Direct | Same keywords, same category |
| Indirect | Solve the same problem differently |
| Aspirational | Top apps in your category |

#### Step 2: Metadata Audit

| Element to analyze | What to check |
|--------------------|-------------|
| Title | Keywords used, structure |
| Subtitle / Short desc | USP positioning |
| Description | Structure, keywords, tone |
| Keywords (iOS) | Spy tools (AppTweak, Astro) |
| What's New | Update frequency, focus |

#### Step 3: Creative Audit

| Element | What to check |
|---------|-------------|
| Icon | Colors, style, trend in the category |
| Screenshots | Structure, captions, storytelling |
| Video | Whether they have one, how long, what it shows |
| CPP/CSL | How many variants, for which keywords |

#### Step 4: Performance Audit

| Metric | What to check |
|---------|-------------|
| Rating | Average rating, trend, velocity |
| Reviews | Sentiment, common complaints |
| Ranking per keyword | Position vs yours |
| Download estimates | Estimation tools |
| Update frequency | How often they update |

#### Step 5: Keyword Gap Analysis

```
1. List the keywords YOU rank for
2. List the keywords COMPETITORS rank for
3. Gap = competitors' keywords MINUS your keywords
4. Prioritize gap keywords by: relevance × volume × difficulty
5. Add the top gap keywords to your metadata
```

#### Step 6: Marketing Events & Update Frequency

| Element to monitor | What to check |
|--------------------------|-------------|
| **In-App Events / LiveOps** | Event strategy: frequency, types, timing |
| **Update frequency & impact** | How often they update and how it affects ranking/reviews |
| **Feature benchmarking** | Compare the feature set — what you lack that they have |
| **Paid campaigns** | Apple Search Ads keywords, Google Ads creative |
| **Seasonal strategies** | Alignment with the seasonal calendar |

### Competitor analysis tools:

| Tool | What it offers |
|-----------|-----------|
| **AppTweak** | Keyword spy, CPP Explorer, metadata change timeline |
| **Sensor Tower** | Download/revenue estimates, keyword rankings |
| **MobileAction** | Keyword discovery, competitor monitoring |
| **AppFollow** | Keyword Spy tab, review monitoring |
| **ASO.dev** | Ranking per keyword, downloads, revenue |
| **Astro** | Competitor keyword discovery, ranking tracking |
| **App Radar** | Keyword monitoring, competitor alerts |

### What to monitor on a recurring basis:

- [ ] Competitor metadata changes (title, description, keywords)
- [ ] New screenshots / icons (A/B tests)
- [ ] New CPP/CSL
- [ ] Rating velocity (sudden spike → campaign?)
- [ ] In-App Events / LiveOps
- [ ] New versions (changelog analysis)
- [ ] Paid campaigns (Apple Search Ads keywords)

---

## 7. Seasonal ASO

### Seasonal calendar — month by month:

| Month | Main events | Categories with a boost | What to optimize |
|---------|--------------|---------------------|-----------------|
| **January** | New Year, resolutions | Fitness, Health, Finance, Productivity, Education | Keywords: "new year resolution", "lose weight 2026" |
| **February** | Valentine's Day (14), Super Bowl | Dating, Social, Food delivery, Sports, Streaming | Keywords: "valentine gift", "dating app" |
| **March** | Women's Day (8), Spring, St. Patrick | Fashion, Beauty, Health, Social media | Keywords: "women's day", "spring cleaning" |
| **April** | Easter, Earth Day (22), Tax Season | Finance, Tax, Shopping, Eco apps | Keywords: "easter sale", "tax filing" |
| **May** | Mother's Day, Memorial Day | Shopping, Gift, Travel, Photo | Keywords: "mother's day gift", "travel deals" |
| **June** | Start of summer, Father's Day, Pride | Travel, Fitness outdoor, Social, Entertainment | Keywords: "summer vacation", "beach workout" |
| **July** | Holidays, Independence Day (US) | Travel, Navigation, Language learning, Games | Keywords: "road trip", "learn language" |
| **August** | Back to School | Education, Productivity, Calendar, Note-taking | Keywords: "back to school", "study app" |
| **September** | Back to School 2, Apple launch | Education, Productivity, Tech | Keywords: "school organizer", "new iPhone" |
| **October** | Halloween (31), Oktoberfest | Games, Photo editing, Social, Food | Keywords: "halloween costume", "scary games" |
| **November** | Black Friday, Cyber Monday, Thanksgiving | Shopping, Finance, Deals, ALL categories | Keywords: "black friday deals", "cyber monday" |
| **December** | Christmas, New Year, Hanukkah | Shopping, Gift, Entertainment, Family games | Keywords: "christmas gift", "holiday" |

### Preparation timeline:

```
T-3 months:  Research — seasonal keyword analysis, benchmarking
T-2 months:  Creative — new screenshots, icon, descriptions
T-6 weeks:   Submission — featuring request to Apple/Google
T-4 weeks:   A/B Test — test seasonal variants
T-2 weeks:   Launch — publish seasonal metadata + events
T-0:         Event — monitor performance daily
T+1 week:    Rollback — revert to standard creatives
```

### Real-world case studies:

| Brand | Event | Result |
|-------|-------|-------|
| **Best Buy** | Black Friday ASO | **+454%** download growth |
| **Adidas** | Black Friday ASO | **+582%** download growth |
| **Upside** | Black Friday keywords | Ranked #9 for "Black Friday" |
| **Festive icon update** | Christmas (SplitMetrics) | **+47% conversion uplift** |

### Seasonal tactics:

1. **Keywords** — add seasonal keywords to metadata 2-4 weeks before the event
2. **Screenshots** — seasonal backgrounds/decorations, but keep the core branding
3. **Icon** — subtle changes (Santa hat, Valentine's hearts) — **NOT** a revolution
4. **Description** — seasonal references in promotional text (iOS) / short description (Android)
5. **In-App Events** — create an event matched to the season
6. **CPP/CSL** — seasonal Custom Product Page variants
7. **Ads** — increase budget on seasonal keywords

---

## 8. App icon

### 10 rules of advanced icon design:

1. **One idea** — communicate a single concept clearly
2. **App's purpose visible instantly** — the user must understand the functionality instantly
3. **Consistency with the UI** — the icon must reflect what's inside
4. **Strategic brand colors** — dominant color = brand + category
5. **Avoid text** — it pixelates at small sizes, causes localization problems
6. **Logo only for strong brands** — an unknown logo doesn't communicate value
7. **Seasonal variants** — subtle changes for holidays → activity signal
8. **Localize for key markets** — cultural nuances affect conversion
9. **Research, then stand out** — check category trends, then break the pattern
10. **A/B test continuously** — even subtle tweaks → double-digit improvements

### Technical requirements:

| Platform | Size | Format | Notes |
|-----------|---------|--------|-------|
| iOS | 1024×1024 px | PNG | System adds rounded corners |
| iOS 26 (Liquid Glass) | 1024×1024 px | Layered PNG | Blur, depth, light refraction |
| Android | 512×512 px | PNG | Full bleed, no shadows |
| watchOS | Circular | PNG | Circle shape |

### Trends 2026:

- **iOS 26 Liquid Glass** — layered icons with blur and depth effects — "the biggest UI upgrade since iOS 7"
- **Dark mode first** — dark icons stand out in a sea of bright ones
- **Minimalism** — fewer elements, more impact
- **Gradient revival** — subtle gradients are back
- **Character-first** (games) — the main character prominent

### A/B testing icons — framework:

```
1. Baseline: current icon (control)
2. Variant A: change background color
3. Variant B: change the main element
4. Use A/B/B testing (two variants vs control) — prevents false positives
5. Measure: CVR (conversion rate), CTR, install rate
6. Min 7 days, statistically significant sample
7. Winner → new baseline → new test
```

**Case study:** AppQuantum achieved a **+21.5% increase in installs** through A/B testing of mobile game icons.

---

## 9. Rating Prompt Strategy

### When to ask for a rating (optimal timing):

| Moment | Why it works | Example |
|--------|----------------|---------|
| **After completing a task** | Satisfaction from achievement | After finishing a workout |
| **After reaching a milestone** | Sense of progress | "You completed lesson 10!" |
| **After a positive result** | Good mood | After saving to a budget |
| **After X sessions** | Engaged user | After the 5th session in the app |
| **After a purchase** | Investment = commitment | After subscribing |

### When NOT to ask:

| Moment | Why not |
|--------|-------------|
| After a crash / error | Frustration → low rating |
| During a critical task | Breaking the flow → irritation |
| On first launch | No experience with the app |
| After declining a previous request | Spamming → negative perception |
| During onboarding | Too early, no value yet |

### Implementation:

| Platform | API | Limit |
|-----------|-----|-------|
| iOS | `SKStoreReviewController` | Max 3 times per 365 days |
| Android | Play In-App Review API | Quota managed by Google |

### Review strategy:

1. **Respond to ALL reviews** — positive and negative
2. **Negative → fast** — show that you're listening
3. **Positive → thank you** — build a relationship
4. **Address feedback in updates** — "We fixed the issue you reported"
5. **Monitor sentiment** — AI tools for trend analysis
6. **Goal: 4.0+★** — below 4★ "often struggle to gain traction"

---

## 10. ASO tools

### Comprehensive platforms:

| Tool | Main feature | Price |
|-----------|---------------|------|
| **AppTweak** | Keywords, competitor, timeline, CPP Explorer, localization | From $69/mo |
| **Sensor Tower** | Downloads/revenue estimates, keyword rankings | Enterprise |
| **MobileAction** | Keyword discovery, competitor, market intelligence | From $59/mo |
| **data.ai** (ex-App Annie) | Market data, competitor analysis, estimates | Enterprise |
| **AppFollow** | Reviews, keyword spy, ASO monitoring | From $111/mo |

### Specialized tools:

| Tool | Specialization |
|-----------|--------------|
| **SplitMetrics** | A/B testing iOS (CPP, icons, screenshots) |
| **StoreMaven** | A/B testing + creative intelligence |
| **ASO.dev** | Keywords, ranking tracking |
| **Astro** | Competitor keyword spy |
| **App Radar** | ASO workflow, keyword monitoring |
| **AppTamin** | App preview video production |
| **The ASO Project** | CRO agency + screenshot design |

### Additional specialized tools:

| Tool | Specialization |
|-----------|--------------|
| **ASODesk** | Keyword tracking, metadata tools, review management (small-mid teams) |
| **Geeklab** | Pre-launch A/B testing — look-alike product pages, concept validation |
| **Appbot** | Review monitoring, multi-store (iOS, Google Play, Amazon), auto replies |
| **42matters** | App store data API — metadata, SDK insights, broad analytics |
| **Reporting Studio (AppTweak)** | Unified dashboards (ASO + consoles + MMPs), no-code reporting |

### MMP / Attribution tools:

| Tool | Specialization |
|-----------|--------------|
| **AppsFlyer** | Mobile attribution, deep analytics, fraud protection |
| **Adjust** | Campaign performance, user analytics, CTV |
| **Branch** | Deep linking, user engagement, web-to-app |
| **Singular** | Marketing + attribution in one, 1000+ ad networks |

### Creative design tools:

| Tool | Specialization |
|-----------|--------------|
| **Figma** | Collaborative UI/UX design, team workflows |
| **Canva** | Quick, user-friendly design, templates |
| **Animoto** | Video creation, drag-and-drop |

### Free tools:

| Tool | What it gives |
|-----------|---------|
| **Google Play Console** | Store Listing Experiments, Android Vitals |
| **App Store Connect** | CPP, Product Page Optimization |
| **Google Trends** | Seasonal keyword trends |
| **ChatGPT / Claude** | Keyword brainstorming, description writing |
| **Google Natural Language Analysis** | Check how AI interprets your metadata |

### Algorithm Change Detector:
- **AppTweak's App Store Algorithm Change Detector** — monitors changes to the Apple and Google Play algorithms
- Detects anomalies in keyword rankings
- Helps distinguish a drop caused by an algorithm change from a competitive drop
- **Don't react impulsively** to fluctuations — first verify whether it's an algorithm change

---

## 11. Additional case studies and benchmarks

### Case studies (2025-2026):

| Brand | Strategy | Result |
|-------|-----------|-------|
| **Wix** | Keyword optimization | #1 ranking on top 3 keywords |
| **Superscale** | Comprehensive ASO on Google Play | **+450% growth in organic downloads** |
| **AppQuantum** | Creative A/B testing (icons, screenshots) | **+21% increase in installs** |
| **Upside** | Seasonal ASO (Black Friday) | #9 ranking for "Black Friday", +10% visibility |
| **The North Face** | Review prompt after purchase | Rating: 3.68→4.23 iOS, 3.71→4.54 Android |
| **Vinted** | Keyword research + competitor monitoring | Top 10 on 210 new keywords across 6 EU markets |
| **IE Business School study** | General analysis of 16,897 games | **+12% downloads** on average thanks to ASO |

### Key benchmarks (AppTweak ASO Benchmarks 2025):

| Metric | Value |
|---------|---------|
| Apps with a rating of 4+ among the featured | **92%** |
| Top apps updating screenshots 2+/year | **~50%** |
| Top games A/B testing screenshots/icons 2+/year on GP | **57%** |
| Optimal cadence for updating iOS metadata | Every **4 weeks** |
| Optimal cadence for updating GP metadata | Every **4-6 weeks** |
| Subtitles localization rate (top iOS apps) | **88%** |
| Description localization rate (top iOS apps) | **82%** |

### On-metadata vs Off-metadata factors:

**On-metadata (controlled by the publisher):**
- App title, subtitle, keyword field, short/long description
- Promo text (iOS), app icon, screenshots, preview video
- Category, URL/package

**Off-metadata (out of your control, but huge impact):**
- Ratings & reviews, download count, download velocity
- App size, bugs/crashes, retention rate, uninstall rate

---

## Sources

- [AppTweak — App Store Ranking Factors 2026](https://www.apptweak.com/en/aso-blog/app-store-ranking-factors)
- [MobileAction — Google Play Ranking Factors](https://www.mobileaction.co/blog/google-play-store-ranking-factors/)
- [MobileAction — App Store Ranking Factors](https://www.mobileaction.co/blog/app-store-ranking-factors/)
- [AppTweak — Custom Product Pages Guide](https://www.apptweak.com/en/aso-blog/guide-to-custom-product-pages-cpp)
- [AppTweak — Custom Store Listings](https://www.apptweak.com/en/aso-blog/custom-store-listings)
- [MobileAction — In-App Events & Promotional Content](https://www.mobileaction.co/guide/in-app-events-promotional-content-guide/)
- [AppTweak — Apple Search Ads Guide](https://www.apptweak.com/en/aso-blog/guide-to-apple-search-ads)
- [SplitMetrics — ASO & Apple Search Ads Synergy](https://splitmetrics.com/blog/app-store-optimization-aso-apple-search-ads-synergy/)
- [AppTweak — App Icon Design](https://www.apptweak.com/en/aso-blog/how-to-design-an-app-icon)
- [MobileAction — How to Improve App Store Rating](https://www.mobileaction.co/blog/how-to-improve-app-store-rating/)
- [AppTweak — App Store Seasonality](https://www.apptweak.com/en/aso-blog/app-store-seasonality)
- [Moburst — App Store Ranking Factors](https://www.moburst.com/blog/app-store-ranking-factors/)
- [SEM Nexus — ASO 2026 What Drives Installs](https://semnexus.com/app-store-optimization-in-2026-what-actually-drives-installs-now/)
- [AppTweak — How to Build an Effective ASO Strategy 2026](https://www.apptweak.com/en/aso-blog/how-to-build-an-effective-aso-strategy)
- [AppTweak — Best ASO Tools of 2026](https://www.apptweak.com/en/aso-blog/best-aso-tools)
- [AppTweak — What is ASO: Guide 2026](https://www.apptweak.com/en/aso-blog/what-is-app-store-optimization-and-why-is-aso-important)
- [Moburst — Complete ASO Guide 2026](https://www.moburst.com/blog/app-store-optimization-guide/)
- [AppFollow — Advanced ASO Strategies Webinar 2026](https://appfollow.io/blog/advanced-aso-strategies-2026)
- [MobileAction — ASO Tips and Tricks 2026](https://www.mobileaction.co/blog/aso-tips-and-tricks/)
- [Yodel Mobile — App Growth Playbook 2026](https://www.businessofapps.com/insights/your-essential-guide-to-aso-success-in-2026-is-here/)
- [MobiLoud — Practical Guide to ASO](https://www.mobiloud.com/blog/app-store-optimization)
- [Scalebay — Ultimate ASO Guide 2026](https://scalebay.io/blog/the-ultimate-2025-aso-guide)
- [ASOWorld — Essential ASO Guide 2026](https://asoworld.com/blog/what-is-app-store-optimization/)

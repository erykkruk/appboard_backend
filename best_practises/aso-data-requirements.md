# Required app data for generating ASO content

> What information we collect from the user so that the AI can generate good descriptions, keywords, screenshot captions and the entire listing.

---

## Structure: Required → Optional

```
REQUIRED (without this we can't write anything meaningful)
  └── Core Info — 5-7 questions, ~2 minutes

OPTIONAL (better output, but doesn't block generation)
  ├── Audience & Positioning — persona, competitors
  ├── Tone & Branding — communication style
  ├── Advanced Keywords — manual keywords, exclusions
  └── Seasonal & Campaign — seasonal needs
```

---

## REQUIRED — Mandatory information

> The minimum needed to generate a meaningful listing. Without this data it's impossible to write.

### 1. Basic app info

| Field | Type | Description | Example |
|------|-----|------|---------|
| **app_name** | string | App name (brand) | "Calm" |
| **platform** | enum | `ios` / `android` / `both` | "both" |
| **category** | string | Main category in the store | "Health & Fitness" |
| **one_liner** | string (max 120 chars) | One sentence — what the app does | "Meditation and sleep app that helps you reduce stress and sleep better" |

### 2. Problem and value

| Field | Type | Description | Example |
|------|-----|------|---------|
| **problem** | string | What problem does it solve? What is the user's pain? | "Users struggle with stress, anxiety, and poor sleep quality" |
| **main_benefit** | string | Main benefit — what the user GAINS | "Fall asleep faster and feel calmer throughout the day" |
| **key_features** | string[] (3-5) | List of key features (short, 5-10 words each) | ["Guided meditations for beginners", "Sleep stories narrated by celebrities", "Breathing exercises for anxiety", "Daily calm 10-min session"] |

### 3. Differentiators

| Field | Type | Description | Example |
|------|-----|------|---------|
| **differentiator** | string | What sets it apart from competitors? Why this app and not another? | "Largest library of sleep stories, narrated by Matthew McConaughey and others" |

### 4. Language

| Field | Type | Description | Example |
|------|-----|------|---------|
| **languages** | string[] | Which languages/markets to generate for | ["en", "pl", "de", "es"] |

---

**Total required: 8 fields.** The user fills out the form in ~2 minutes and gets:
- Title + subtitle (iOS) / short description (Android)
- Long description (4000 characters)
- Keyword suggestions (iOS keyword field)
- Screenshot captions (8-10 proposals)

---

## OPTIONAL — Additional information

> Each additional section **improves the quality** of the generated content, but is NOT required.

### A. Target audience (Audience)

| Field | Type | Description | Example |
|------|-----|------|---------|
| **target_audience** | string | Who is the ideal user? | "Busy professionals aged 25-45 who struggle with work-life balance" |
| **user_persona_name** | string | Optionally: name the persona | "Stressed Sarah" |
| **pain_points** | string[] | Detailed user problems (3-5) | ["Can't fall asleep", "Anxiety during meetings", "No time for self-care"] |
| **user_language** | string | How do users describe their problem? (their words) | "I just can't turn off my brain at night" |

**Impact:** The description hits the needs better, keywords closer to users' language.

**Example of a full persona (fitness app):**
```
Persona: "Fitness Fiona"
- Age: 30, woman, office worker
- Problem: values wellness but has no time to exercise due to a packed schedule
- Looking for: quick home workouts, guided sessions, personalized plans
- Keywords derived from the persona: "lazy workout", "home fitness", "15-minute workout", "women workout"
- Screenshot messaging: "Quick 15-min workouts" > "Workout tracker"
- CPP/CSL: a separate page with images of home workouts, captions "No gym needed"
```

> **Tip**: The persona should inform ALL aspects of ASO — from keyword selection, through screenshot captions, to CPP/CSL targeting.

### B. Competitors and positioning

| Field | Type | Description | Example |
|------|-----|------|---------|
| **competitors** | string[] (1-5) | Names of the main competitors | ["Headspace", "Insight Timer", "Balance"] |
| **competitive_advantage** | string | In detail: how do you win? | "More content variety + celebrity narrators + no commitment required" |
| **positioning** | enum | How do you position yourself? | "premium" / "value" / "freemium" / "niche" |

**Impact:** Differentiating descriptions, avoiding the same keywords as competitors, keyword gap analysis.

### C. Tone and branding

| Field | Type | Description | Example |
|------|-----|------|---------|
| **tone** | enum / string | Communication tone | "calm_friendly" / "professional" / "playful" / "authoritative" / custom |
| **brand_voice_examples** | string | Example sentence in the brand's style | "Take a deep breath. We've got you." |
| **words_to_avoid** | string[] | Words/phrases NOT to use | ["addictive", "cheap", "hustle"] |
| **words_to_include** | string[] | Words/phrases that MUST appear | ["science-backed", "free trial"] |

**Impact:** Consistent tone in descriptions, screenshot captions in the brand's style.

### D. Social proof and achievements

| Field | Type | Description | Example |
|------|-----|------|---------|
| **download_count** | string | Number of downloads (approximate) | "10M+" |
| **rating** | number | Average rating | 4.8 |
| **rating_count** | string | Number of ratings | "500K+" |
| **awards** | string[] | Awards, recognitions | ["Apple App of the Year 2024", "Google Play Editor's Choice"] |
| **press_quotes** | string[] | Media quotes | ["'The #1 app for sleep' — The New York Times"] |
| **testimonials** | string[] | User quotes | ["'Changed my life. I sleep 2 hours more now.' ★★★★★"] |

**Impact:** Social proof in descriptions and on screenshots, building trust.

### E. Product details

| Field | Type | Description | Example |
|------|-----|------|---------|
| **pricing_model** | enum | Pricing model | "freemium" / "subscription" / "one_time" / "free_with_ads" |
| **price** | string | Price (if applicable) | "$69.99/year or $14.99/month" |
| **free_features** | string[] | What's available for free | ["7-day beginner course", "Daily Calm", "3 sleep stories"] |
| **premium_features** | string[] | What's in the premium version | ["Full library 1000+ meditations", "Masterclasses", "Offline access"] |
| **supported_devices** | string[] | Devices | ["iPhone", "iPad", "Apple Watch", "Android"] |

**Impact:** A better description of the pricing model, a convincing free vs premium pitch.

### F. Keywords (advanced)

| Field | Type | Description | Example |
|------|-----|------|---------|
| **must_include_keywords** | string[] | Keywords that MUST be included | ["meditation", "sleep", "anxiety"] |
| **exclude_keywords** | string[] | Keywords to exclude | ["hypnosis", "ASMR"] |
| **long_tail_keywords** | string[] | Specific long-tail phrases | ["meditation for beginners", "sleep sounds for babies"] |
| **seasonal_keywords** | string[] | Seasonal keywords (if relevant) | ["new year meditation", "stress relief holidays"] |

**Impact:** A more precise keyword field, better-matched descriptions.

### G. Seasonality and campaigns

| Field | Type | Description | Example |
|------|-----|------|---------|
| **current_campaign** | string | Current campaign/event | "New Year 'Fresh Start' campaign" |
| **seasonal_theme** | string | Seasonal theme | "Winter wellness" |
| **promotion** | string | Current promotion | "50% off annual subscription" |
| **cta_override** | string | Custom CTA instead of the default | "Start your 30-day free journey" |

**Impact:** A seasonally-matched listing, promotional text, events.

---

## Mapping: data → ASO output

| Generated element | Required fields | Optional fields (improve quality) |
|-------------------|----------------|-------------------------------------|
| **Title** (30 chars) | app_name, one_liner | must_include_keywords, competitors |
| **Subtitle** (iOS, 30 chars) | main_benefit, key_features | tone, competitive_advantage |
| **Short description** (Android, 80 chars) | one_liner, main_benefit | must_include_keywords, tone |
| **Keyword field** (iOS, 100 chars) | key_features, one_liner, category | competitors, must/exclude keywords, long_tail |
| **Long description** (4000 chars) | problem, main_benefit, key_features, differentiator | ALL optional — each field improves quality |
| **Screenshot captions** | key_features, main_benefit | tone, brand_voice, social_proof, pain_points |
| **Promotional text** (iOS) | main_benefit | current_campaign, promotion, seasonal_theme |
| **What's New** | key_features | tone |
| **In-App Event metadata** | one_liner | seasonal_theme, promotion, campaign |

---

## UX Flow — how to collect the data

### Step 1: Quick Setup (required, ~2 min)
```
"Tell us about your app"

[App name]               ← text input
[Platform]               ← toggle: iOS / Android / Both
[Category]               ← dropdown with App Store/Google Play categories
[What does your app do?] ← textarea, max 120 chars, placeholder: "One sentence describing your app"
[What problem does it solve?] ← textarea, placeholder: "What do your users struggle with?"
[Main benefit]           ← textarea, placeholder: "What does the user gain? What result?"
[3-5 key features]       ← multi-input, add/remove, placeholder: "e.g. Guided meditations for beginners"
[What sets you apart?]   ← textarea, placeholder: "Why should someone choose your app?"
[Languages]              ← multi-select with flags
```

→ **Generate** the basic listing.

### Step 2: Enhance (optional, expandable sections)

```
"Want a better result? Add more context"

[▸ Target audience]      ← collapsed section
[▸ Competitors]          ← collapsed section
[▸ Tone and branding]    ← collapsed section
[▸ Social proof]         ← collapsed section
[▸ Product details]      ← collapsed section
[▸ Keywords]             ← collapsed section
[▸ Seasonal campaign]    ← collapsed section
```

Each section is **collapsed** and optional. The user expands only the ones they want to fill in.

→ **Regenerate** the listing taking the additional data into account.

### Step 3: Review & Edit

```
The AI generates:
├── Title + Subtitle
├── Short description (Android)
├── Long description
├── Keywords (iOS)
├── 8-10 screenshot caption proposals
└── Promotional text (optional)

The user can:
├── Edit each element inline
├── Regenerate a single section
├── Change the tone/style and regenerate
└── Export / copy to ASC/GPC
```

---

## Field validation

| Field | Validation |
|------|----------|
| app_name | required, 1-30 chars |
| platform | required, enum |
| category | required, from the App Store / Google Play list |
| one_liner | required, 10-120 chars |
| problem | required, 20-500 chars |
| main_benefit | required, 10-200 chars |
| key_features | required, 3-5 items, each 5-80 chars |
| differentiator | required, 20-300 chars |
| languages | required, min 1 |
| target_audience | optional, 20-300 chars |
| competitors | optional, 1-5 strings |
| tone | optional, enum or custom string |
| download_count | optional, string |
| rating | optional, 1.0-5.0 |
| must_include_keywords | optional, 1-20 strings |
| exclude_keywords | optional, 1-20 strings |

---

## Implementation priorities

| Phase | What we implement | Data |
|------|------------------|------|
| **MVP** | Generating description + keywords | Required only (8 fields) |
| **v1.1** | Audience + Competitors + Tone | + sections A, B, C |
| **v1.2** | Social proof + Product details | + sections D, E |
| **v1.3** | Advanced keywords + Seasonal | + sections F, G |
| **v2.0** | Auto-fill from App Store/Google Play scraping | Many fields automatically |

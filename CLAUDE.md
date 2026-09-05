# AppBoard Backend

## Overview
Backend API for AppBoard — an ASO (App Store Optimization) management tool. Manages store connections, app metadata, and listing optimization.
Admin Panel - /Users/erykkruk/Development/Github/AppBoard/appboard_web
Website - /Users/erykkruk/Development/Github/AppBoard/appboard_website


## Tech Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Runtime | Bun | 1.3.x |
| Framework | Elysia | 1.4.x |
| Database | PostgreSQL | 18 |
| ORM | Drizzle ORM | 0.45.x |
| Validation | ArkType | 2.1.x |
| Linter/Formatter | Biome | 2.3.x |
| Logger | Pino | 10.x |
| Package Manager | bun | - |

## Development Commands

| Command | Description |
|---------|------------|
| `bun run dev` | Start dev server with watch mode |
| `bun run start` | Start production server |
| `bun test` | Run tests |
| `bun run db:up` | Start PostgreSQL container |
| `bun run db:generate` | Generate Drizzle migrations |
| `bunx biome check --write .` | Lint and format all files |

## Directory Structure

```
src/
├── config/
│   ├── index.ts          # ArkType-validated env config
│   └── const.ts          # Shared constants, enums, types
├── modules/
│   ├── pagination/
│   │   └── index.ts      # Pagination Elysia macro
│   └── system/
│       ├── index.ts       # Health endpoint + bootstrap
│       ├── db.service.ts  # Paginated query helper
│       └── pagination.service.ts # Pagination response builder
├── utils/
│   ├── db/
│   │   ├── index.ts       # Drizzle client
│   │   ├── schema.ts      # Database tables
│   │   ├── relations.ts   # Drizzle relations
│   │   ├── migrate.ts     # Migration runner
│   │   └── drizzle/       # Generated SQL migrations
│   ├── errors/
│   │   ├── index.ts       # Error types + buildError()
│   │   └── errorHandler.ts # Global Elysia error handler
│   ├── crypto.ts          # AES-256-GCM encrypt/decrypt
│   ├── helpers.ts         # Shared helper functions
│   └── logger.ts          # Pino logger factory
├── test/
│   ├── setup.ts           # Test setup
│   ├── health.test.ts     # Health endpoint tests
│   ├── crypto.test.ts     # Crypto utility tests
│   └── errors.test.ts     # Error utility tests
└── index.ts               # App entry point
```

## Architecture Pattern

Feature-based modules under `src/modules/`. Each module contains its own controller, service, and types. Shared utilities live in `src/utils/`.

## Module Structure

```
src/modules/{feature}/
├── index.ts              # Elysia controller (routes)
├── {feature}.service.ts  # Business logic
├── {feature}.types.ts    # Feature-specific types
└── {feature}.test.ts     # Feature tests
```

## Naming Conventions

- Files: kebab-case (e.g., `error-handler.ts`) or dot-notation for services (e.g., `db.service.ts`)
- Classes: PascalCase
- Functions: camelCase
- Constants: SCREAMING_SNAKE_CASE
- DB tables: snake_case (handled by Drizzle casing config)

## Error Handling

Use `buildError()` from `@/utils/errors`:
```typescript
import { buildError } from "@/utils/errors";
buildError("notFound", { info: "App not found" });
```

All errors are typed via the `errors` object. Never throw raw errors.

## Multi-tenancy (Workspace Scoping)

All data is workspace-scoped. Every endpoint MUST operate within the authenticated user's workspace context.

- Auth guard (`src/modules/auth/index.ts`) derives `userId` + `workspaceId` from request
- Every store-scoped endpoint must call `verifyStoreOwnership(storeId, workspaceId!)`
- Every app-scoped endpoint must call `verifyAppOwnership(appId, workspaceId!)` (joins through stores)
- Service methods that query data MUST filter by `workspaceId` — never return cross-workspace results
- Settings use `(workspaceId, key)` unique constraint — same key can exist per workspace

### Testing workspace context
- ALL tests MUST run authenticated via `authRequest()` from `test/setup.ts` (workspace A)
- Use `authRequestB()` for cross-workspace isolation tests (workspace B)
- `seedTestStore()` accepts optional `workspaceId` (defaults to workspace A)
- When writing new tests: always verify that workspace B cannot access workspace A resources
- Integration tests should cover the full flow: connect → sync → save → publish

## Feature Flags System

Workspace-scoped toggles for 12 modules. Reuses the `settings` table with `FEATURE_` prefix — no new migrations.

- **Definitions**: `src/modules/features/features.const.ts` — `FEATURE_DEFINITIONS`, `ROUTE_FEATURE_MAP`, `matchesPathPattern()`
- **Service**: `src/modules/features/features.service.ts` — `getAll()`, `isEnabled()`, `setAll()` (transactional)
- **Controller**: `src/modules/features/index.ts` — `GET /api/features`, `PATCH /api/features`
- **Guard**: `src/modules/features/features.guard.ts` — scoped `onBeforeHandle` hook returning 403 for disabled features

**Dependency cascade**: `dependsOn` in a definition forces a feature `false` when any dep is `false` (e.g., `MONETIZATION_CHAT` depends on `AI` + `PURCHASES`). Handled in `applyDependencyCascade()`.

**Path matching**: `matchesPathPattern()` uses segment-based subsequence matching — prevents `/api/ai` from matching `/api/ai-chat-history`.

**Registration order** (`src/index.ts`): `featuresController` → `featureGuard` → all other controllers. Guard must run BEFORE protected controllers inside the `/api` group.

## Research Module

Market research for ANY store app (not just connected ones) — port of the standalone aso-tool. `src/modules/research/`, all endpoints `POST /api/research/*` (search, scrape, analyze, keywords, markets, visual, competitors, compare), gated by the `RESEARCH` feature flag.

- **Scraping**: iTunes API via raw fetch (`appstore.client.ts`); Google Play via `google-play-scraper` (`playstore.client.ts`, sort NEWEST = raw `2`).
- **IMPORTANT — Apple reviews RSS is dead** (returns 0 entries for every app since mid-2026). `appstoreReviews()` tries RSS first, then falls back to parsing `"$kind":"Review"` objects server-rendered into `https://apps.apple.com/{cc}/app/id{id}?see-all=reviews` (~50 reviews). The amp-api requires a token that is no longer embedded in the page/JS — don't waste time hunting for it.
- **AI** (`research.ai.ts`): OpenRouter with workspace `OPENROUTER_API_KEY` setting (same as ai module); model override via `RESEARCH_MODEL` setting or request body; Polish prompts; responses validated with ArkType; deep mode = map-reduce (chunks of 150, 3 parallel).
- **Heuristics** (`research.heuristics.ts`): keyword-bucket categorization (EN+PL) of negative reviews — works without an AI key, returned with every scrape.
- Caps: keywords ≤15, single-pass analysis ≤300 reviews, Play reviews 250/1500 (deep), compare 120/side, visual ≤6 images.
- **Keyword scoring** (`POST /api/research/keyword-scores`, ≤10 keywords, App Store only): popularity estimate (1-100, regression calibrated against Apple's official searchPopularity1to100 - weights in `keyword-scoring.ts` are calibrated constants, NEVER hand-tune), difficulty (7 weighted sub-scores + backfill/weak-leader/small-result corrections + brand-keyword detection + Top 5/10/20 tiers with monotonicity), opportunity + classification (`sweet-spot`/`hidden-gem`/... kebab ids, frontend renders labels), download estimates (searches x TTR power-law x CVR range, per-country market multipliers). All pure math over one iTunes search per keyword (25 competitors); methodology reimplemented from RespectASO (AGPL) - logic rewritten in TS, do not copy their code verbatim.

## Keyword Score History + Apple Ads

- **History**: `keyword_score_snapshots` - one row per workspace+keyword+country+day, upserted by every `POST /api/research/keyword-scores` call. Endpoints: `GET .../history` (latest per pair, no payload), `GET/DELETE .../history/:id`, `GET .../trend`, `GET .../summary` (per-country aggregates: download intervals at current ranks, classification distribution, top opportunities). Retention 90 days (scheduler cleanup).
- **Scheduler** (`tracking/scheduler.service.ts`): 00:00/12:00 rank checks, 00:00 auto-research, **01:00 keyword-score refresh** (tracked keywords of rank-tracking-enabled apps), **02:00 Apple dataset sync** (no-op outside Monday rollovers).
- **Apple Ads** (`src/modules/apple-ads/`, flaga RESEARCH, prefix `/api/apple-ads`): oficjalna popularity z Apple Ads Platform API v1. Credentials per workspace w `settings` (APPLE_ADS_* - private key encrypted); wazne: popularity endpoint to DATASET (top ~500 terms per genre per tydzien Sun-Sat), nie lookup - sync do `apple_top_terms` + `apple_dataset_weeks` (kwarantanna: tydzien aktywowany dopiero po walidacji; retention 26 tygodni). Scoring robi dual-source: `POPULARITY_SOURCE` setting (internal|apple); przy "apple" wartosc oficjalna gdy term jest w datasecie, inaczej estymata z capem = floor kategorii - 1 (`inferAppleGenre` glosuje po konkurentach). `KeywordScore.popularity` = wartosc EFEKTYWNA; `internalPopularity`/`applePopularity`/`popularitySource`/`popularityFallback` niosa szczegoly. Impression share per apka: `apple_impression_shares` (sync on demand).
- **Resilience**: `appstoreKeywordSearch` ma SSR fallback (serialized-server-data + Lookup API, identyczny ksztalt), `appstoreKeywordRank` skanuje top 200 z fallbackiem SSR; batch scoring pacing adaptacyjny 300ms->3s.
- **Kalibracja**: `scripts/estimator-study.ts` - refit wag estymatora na oficjalnych danych (print-only; wagi w `keyword-scoring.ts` aktualizowac tylko gdy holdout lepszy). `popularitySignalComponents()` to JEDYNY feature extractor - dzielony przez produkcje i study.

## Public ASO Check-up (free tool ingest)

- **Silnik scoringu jest browser-safe**: `scoring-types.ts` (zero importow) + `keyword-scoring.ts` (importuje TYLKO type-only z scoring-types). Panel (appboard_web) kopiuje oba pliki przez `scripts/sync-aso-engine.sh` i liczy darmowy raport W PRZEGLADARCE uzytkownika (iTunes odpytywany z IP odwiedzajacego - zero calli Apple z naszego backendu dla anonimow). Test `public-reports.test.ts` pilnuje tej granicy - nie dodawaj importow do tych plikow.
- **Ingest**: `POST /api/public/aso-reports` (PRE-auth-guard, jak feedback; rate limit 10/h/IP, IP tylko jako sha256). Tabele `public_aso_reports` + `public_keyword_observations` - crowd data, source="web_client", NIEZAUFANE (walidacja zakresow na wejsciu) i trzymane OSOBNO od danych workspace'ow. To rosnaca baza keyword->score per kraj/dzien.

## Link-first import (public connection mode)

Apps can be added from a public store link WITHOUT API credentials - integration is an optional add-on for publishing.

- `POST /api/stores/import` (body: `{ url }` or `{ platform, externalId, country? }`) parses the link (`stores/store-url.ts`, reuses research `parseStoreUrl`), validates the app exists publicly, creates/reuses ONE credential-less store per (workspace, type) with `stores.connectionMode = "public"` (`credentials = NULL`, status "connected"), inserts the app row and syncs the public listing + screenshots immediately. Import country pinned in `apps.rawData.publicCountry`.
- **Providers**: `src/providers/public/` - `PublicAppStoreProvider` (iTunes lookup + review RSS/web fallback) and `PublicGooglePlayProvider` (google-play-scraper). Reads are wired (listings, assets, reviews, categories); EVERY write raises typed **403 `INTEGRATION_REQUIRED`** - the panel renders a "connect your store API" CTA off that code. Never a silent no-op.
- **Single choke point**: `resolveProviderForStore/ForApp` (`stores/provider-resolver.ts`) replaces the old `decryptCredentials + createProvider` pattern in services. Do NOT construct providers by hand in services - always go through the resolver.
- `storeCapabilityGuard` additionally blocks publishing/purchases MUTATIONS (non-GET) for public apps with 403 INTEGRATION_REQUIRED; GETs stay open (cached/local data). Reviews are not blocked there - public review sync genuinely works, only reply fails at the provider.
- **Upgrade path**: connecting a real API store re-binds imported apps by `externalId` (App Store externalId == iTunes trackId; Play == packageName), so drafts/history/tracked keywords survive; `syncApps` then deletes emptied public connections.
- `GET /stores` and `GET /apps` expose `connectionMode` ("api" | "public") for the panel.
- **Auto research on import**: every import fires a background deep research run (`ResearchRunsService.runForApp` with `autoKeywords: true` - full review scrape, pricing/IAP meta, top-50 positions for keywords derived from title+genre via `mainKeywordCandidates`; AI analysis best-effort). Skipped when `NODE_ENV === "test"` (would outlive stubbed fetch and hit real stores).

## App audit + fix queue (`src/modules/audit/`)

- **Engine = `src/modules/research/listing-audit.ts`** (browser-safe: only type imports from `scoring-types`, synced to the panel by `scripts/sync-aso-engine.sh` together with `keyword-scoring.ts` and `listing-suggestions.ts`; the boundary test in `public-reports.test.ts` guards all three). Rules produce `AuditIssue { actionable }`: `actionable: false` = context the panel must NOT render with a button (few ratings, stale update, ranks-only-brand). Measuring runs on every scored keyword; RECOMMENDING (title-upgrade, missing-winnable-terms) only on `options.recommendable` = own-listing candidates + rivals from the app's own genre (`inGenre`). Never let a cross-category term become advice.
- Keyword candidates: own title/description (multilingual stopword list - Polish/German/French/Spanish fillers included on purpose, "nie"/"nikt" used to become "keywords") + a second pass over rival titles (`extractCompetitorCandidates`). Brand token never counts as a ranking win (`isBrandKeyword`).
- `GET /apps/:id/audit` is **cache-first**: table `app_audits` (unique appId+country, `report` NULL while measuring). A read returns instantly with `status: "measuring" | "ready" | "failed" | "not-in-store"`; the real computation (~1 min of live iTunes calls) runs detached and is re-triggered when older than 12 h or `?refresh=true`. Never make this endpoint blocking again - the socket died at 29 s. Store score comes from the LIVE listing in the audited market's language (`appstoreMeta(id, country, iso)`), draft score from the same rules over the draft row.
- `GET /apps/:id/audit/suggestions` - deterministic before/after proposals (title, subtitle, keyword field) from `listing-suggestions.ts`; accepting is the ordinary `PUT /apps/:id/listings/:language`. The report carries `language` = audited market language so Polish proposals never land on `en-US`.

## Public import: every language, real facts

- `PublicAppStoreProvider.fetchListings` fetches one listing per language in `languageCodesISO2A` via the Lookup `l=` param (`APP_STORE_LOCALES` map in `appstore.client.ts`); a language whose text equals the default is a fallback, not a localization, and is skipped. `fetchAssets(appId, language)` returns that language's screenshots, upgraded from the 320x480 thumbnail to the full-size CDN box (`fullSizeStoreImage`, verified: `1284x2778bb` returns the original, never upscaled). Assets sync reconciles for public connections (rows the store no longer serves are deleted).
- Reviews: `appstoreReviews` MERGES the RSS feed and the store web page (both partial) and dedupes on content; the public provider reads every storefront implied by the app's languages (cap 8) and stamps `territory`. Ratings without text are not exposed by Apple anywhere.
- `apps.rawData.storeFacts` (`{ rating, ratingsCount, version, updatedAt, releaseNotes }`) is written at import, by `syncApps`, and refreshed on every public review sync; `GET /apps/:id/reviews/stats` returns `storeRating` / `storeRatingsCount` next to the text-review average - they are different numbers and the panel shows both.
- Local apps: `POST /apps { name, platform }` creates an app that is in no store (`rawData.notInStore = true`, `externalId = local-<uuid>` so a later real connection can never mis-bind it). The audit answers `not-in-store` immediately; every store write stays a typed 403.

## App events + reminders (`src/modules/tracking/`)

- `app_events` (`AppEventsService.record`, never throws) marks version created/submitted and listing published; `GET /apps/:id/tracking/history` merges them with `listing_history` into chart annotations (`CHART_EVENT_TYPES` only - reminder events are housekeeping).
- `DraftReminderService` (scheduler, 09:00 local): a dirty draft older than 3 days + `notifyEmail` on the tracking config -> one email per app per 7 days, cooldown tracked by the `draft_reminder_sent` event.

## Alternative Stores (MULTI_STORE)

Six Android stores behind the `MULTI_STORE` feature flag, each with a real provider under `src/providers/<store>/`. All extend `AlternativeStoreProvider` (`src/providers/alternative/base.ts`), which raises a typed 400 for every capability a store's API cannot do — **never a silent no-op**. A provider overrides only what it truly implements, so `src/config/store-capabilities.ts` stays honest (`wired` vs `consoleOnly`).

| Store | Wired through the API | Notes |
|-------|----------------------|-------|
| Huawei AppGallery | listings (read/write), submit, screenshot **read** | No app-list endpoint — resolves apps from `packageNames` on the connection. Errors arrive as HTTP 200 + `ret.code != 0`. Screenshot upload has no documented bind step, so it is console-only. |
| Samsung Galaxy Store | listings, screenshots (read/upload), submit | RS256 JWT (≤20 min) → `accessToken` that never expires (re-minted daily). `contentUpdate` replaces the whole screenshot array, so existing images are re-sent with `reuseYn: "Y"`. |
| Amazon Appstore | listings (incl. keywords), screenshots, submit | Everything happens inside an "edit"; every mutation needs `If-Match` with the resource ETag. **412 = app in review**, not a stale tag. No app-list endpoint — uses `packageNames`. |
| RuStore | auth + app list only | Token = base64 `SHA512withRSA` over `keyId + timestamp` (no delimiter), sent as the `Public-Token` header. Publishing is create-a-new-immutable-draft and undocumented → console-only. |
| ONE Store | credential validation only | Its public "v7 API" is the IAP server API; **no app-submission API exists**. |
| Xiaomi GetApps | credential validation only (local PEM parse) | Only an APK push endpoint is documented; no listing metadata API. |

**Credential contract** (exact JSON field names the panel sends to `POST /stores/connect`, validated with ArkType in `src/providers/alternative/credentials.schema.ts`):
`huawei_appgallery` + `amazon_appstore` + `onestore` → `{ clientId, clientSecret }` · `samsung_galaxy` → `{ serviceAccountId, privateKey }` · `rustore` → `{ keyId, privateKey }` · `xiaomi_getapps` → `{ email, privateKey }`. Huawei and Amazon also accept optional `packageNames: string[]`.

Credentials go through the E2EE vault exactly like the primary stores. `credentials.mock === true` still routes to `MockStoreProvider` for the demo seed.

## History + Diff System

GitHub-style version control for listing fields.

- **History**: `src/modules/history/` — `GET /apps/:id/history` (filters: `language`, `field`), `POST /apps/:id/history/:historyId/rollback`. Rollback updates the draft listing and marks `isDirty`.
- **Draft diffs**: `ListingsService.getDraftDiffs(appId)` in `listings.service.ts` + endpoint `GET /apps/:id/listings/diffs` — compares draft vs remote listings per language, returns only changed fields.
- **Underlying data**: `listingHistory` table tracks `oldValue`/`newValue` per field per language on publish.

## Anti-patterns

- NEVER use `console.log` — use `createLogger()` from `@/utils/logger`
- NEVER hardcode secrets — use config from `@/config`
- NEVER put business logic in controllers — use service classes
- NEVER use raw SQL — use Drizzle ORM
- NEVER store credentials unencrypted — use `encrypt()`/`decrypt()` from `@/utils/crypto`
- E2EE vault is OPT-IN per workspace (since 2026-08-30): no vault → credentials are encrypted with the server env key (default); vault configured but locked → 423 `VAULT_LOCKED`; vault unlocked → DEK-wrapped `vault:` blobs. `POST /api/vault/disable` (requires unlocked vault) re-encrypts credentials back to the env key and removes the vault. Never store credentials in plaintext
- NEVER use `any` type
- NEVER skip workspace scoping — every endpoint MUST use `workspaceId` from auth guard
- NEVER write tests without auth context — always use `authRequest()` or `authRequestB()`

## Best Practices

- ALWAYS validate env config with ArkType schema in `@/config`
- ALWAYS use `@/` path aliases for imports
- ALWAYS format with `bunx biome check --write` before committing
- ALWAYS run `bun test` before committing
- ALWAYS use the pagination macro for list endpoints
- ALWAYS export `type App` from index.ts for Eden Treaty client generation

## New Feature Checklist

1. Create module directory under `src/modules/{feature}/`
2. Define service class with business logic — pass `workspaceId` to all queries
3. Define Elysia controller with routes — call `verifyAppOwnership` or `verifyStoreOwnership`
4. Register controller in `src/index.ts` under `/api` group
5. Write tests in `src/test/` — use `authRequest()` for workspace A, test isolation with `authRequestB()`
6. Include workspace isolation tests (workspace B cannot access workspace A resources)
7. Run `bun test` and `bunx biome check --write .`

## Ports

- Backend: 6680
- PostgreSQL: 5441

## Environment

Copy `.env.example` to `.env` for local development. All config is validated at startup via ArkType.

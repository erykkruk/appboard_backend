# AppBoard — Plan napraw

## Podsumowanie review

| Kategoria | Backend | Panel | Razem |
|-----------|---------|-------|-------|
| CRITICAL | 9 | 8 | **17** |
| WARNING | 17 | 14 | **31** |
| NICE TO HAVE | 13 | 10 | **23** |

---

## Sprint 1 — Bezpieczenstwo (P0)

- [ ] Dodac autentykacje na backend (JWT/session) — obecnie 0 endpointow chronionych
- [ ] Nie zwracac sekretow do przegladarki — `GET /api/settings/:key` dekryptuje i zwraca klucze API w plaintext (`settings.service.ts:18-33`, panel `settings/page.tsx:64-76`)
- [ ] Usunac credentials z `StoresService.list()` — SELECT * zwraca zaszyfrowane credentials, controller odfiltrowuje recznie (`stores.service.ts:42-44`)
- [ ] Usunac `apps.rawData` z odpowiedzi API — JSONB z danych store'ow leci do klienta (`apps.service.ts:17-33`)
- [ ] Dodac limity wielkosci plikow na uploady — brak `maxSize` w `t.File()` (`assets/index.ts`, `publishing/index.ts`, `listings/index.ts`)
- [ ] Ograniczyc `remotePatterns` w `next.config.ts` — `hostname: "**"` pozwala na SSRF
- [ ] Dodac security headers w panelu (CSP, X-Frame-Options, X-Content-Type-Options)
- [ ] Dodac rate limiting na endpointy (szczegolnie AI i mutacje)
- [ ] Poprawic walidacje `ENCRYPTION_KEY` — sprawdzic dlugosc 64 hex chars, odrzucic przykladowe klucze
- [ ] Zabezpieczyc/wylaczyc OpenAPI/Swagger w produkcji

## Sprint 2 — Stabilnosc (P0)

- [ ] Zarejestrowac brakujace controllery w `src/index.ts` — `listingsController`, `historyController`, `aiController`, `assetsController` sa niezarejestrowane, endpointy nieosiagalne
- [ ] Dodac `error.tsx` (globalny + per-app) i `loading.tsx` w panelu — crash = bialy ekran
- [ ] Wyciagnac layout (sidebar + shell) z `Providers` do `layout.tsx` — caly panel jest w `"use client"` boundary
- [ ] Naprawic memory leak w `ScreenshotCropDialog` — `URL.createObjectURL()` bez `revokeObjectURL()` (`screenshot-crop-dialog.tsx:69-72`)
- [ ] Wywolac `bootstrap()` PRZED `app.listen()` — serwer przyjmuje requesty przed migracja (`src/index.ts:35-39`)

## Sprint 3 — Performance (P1)

- [ ] Batch upsert w sync operacjach — N+1 queries: `syncApps()` (`stores.service.ts:77-108`), `syncReviews()` (`reviews.service.ts:20-68`), `syncAssets()` (`assets.service.ts:22-65`), `listings.publish()` (`listings.service.ts:351-424`)
- [ ] Dodac indeksy DB — brak indeksow poza PK na: `apps(storeId, externalId, platform)`, `reviews(appId, reviewDate, externalId, rating)`, `assets(appId, externalId)`, `listings(appId, language, source)`, `listingHistory(appId, language)` (`schema.ts`)
- [ ] Zrownoleglic API calls w publishing — `getVersionScreenshots()` 40+ sekwencyjnych requestow, `deleteAllScreenshots()` kasuje po jednym (`publishing.service.ts:665-712, 960-962`)
- [ ] Dodac paginacje na reviews i history — endpointy zwracaja ALL bez limitu
- [ ] Dynamic import `react-easy-crop` (~30KB) i `@dnd-kit` (~20KB) — ladowane statycznie na kazdej stronie
- [ ] Zamienic `<img>` na `next/image` w panelu — brak lazy loading, WebP, responsive (`app-sidebar.tsx`, `dashboard/page.tsx`, `information/page.tsx`, `screenshots/page.tsx`)
- [ ] Skonfigurowac connection pooling w DB (`src/utils/db/index.ts`)
- [ ] Uzyc `COUNT(*)` zamiast fetch all rows w `getDirtyCount()` (`assets.service.ts:186-196`)
- [ ] Zwiekszyc `staleTime` lub wylaczyc `refetchOnWindowFocus` w panelu (`providers.tsx:17-18`)
- [ ] Nie importowac `package.json` do client bundle — uzyc env variable dla wersji (`app-sidebar.tsx:4`)

## Sprint 4 — Testy (P1)

### Panel (0% pokrycia)
- [ ] Setup infrastruktury testowej: vitest + @testing-library/react + MSW
- [ ] Testy API clienta (`api.ts`) — `fetchApi`, `toQuery`, `ApiError`, endpointy
- [ ] Testy core hooks — `use-stores.ts`, `use-apps.ts`, `use-publishing.ts` (13 hookow)
- [ ] Testy komponentow — `AppSidebar`, `CharacterCounter`, `ScreenshotCropDialog`
- [ ] Testy stron — onboarding (formularz polaczenia), publish (publikacja)

### Backend (czesciowe pokrycie)
- [ ] Testy history rollback — mutacja danych kompletnie nietestowana
- [ ] Testy publishing service happy paths — 14 metod ASC bez testow (wymaga mockowania `createAppStoreClient`)
- [ ] Testy assets upload/publish/reorder
- [ ] Testy paginacji — `queryPaginated()`, `generateResponse()`, `paginationQuerySchema`
- [ ] Brakujace edge cases: reviews filtry, stores connect z invalid credentials, listings getByLanguage 404
- [ ] Testy errorHandler — jawne testy PARSE, INTERNAL_SERVER_ERROR, UNKNOWN

## Sprint 5 — Code Quality (P2)

### Deduplikacja
- [ ] Wyciagnac `getAppWithStore()` do shared utility — skopiowane w 5 serwisach (`listings.service.ts`, `reviews.service.ts`, `assets.service.ts`, `publishing.service.ts`, `stores.service.ts`)
- [ ] Przeniesc `LISTING_FIELDS` do `src/config/const.ts` — zduplikowane w `listings.service.ts:12` i `publishing.service.ts:198`
- [ ] Przeniesc `EDITABLE_STATES` do shared const — zduplikowane w `publishing.service.ts:17-21` i `app-store/index.ts:50-54`
- [ ] Wyciagnac `StarRating` do `src/components/star-rating.tsx` — zduplikowane w `dashboard/page.tsx` i `reviews/page.tsx`
- [ ] Wyciagnac `STATE_COLORS`, `STATE_LABELS`, `VERSION_STATE_LABELS` do `src/lib/constants.ts` — zduplikowane w 6+ plikach
- [ ] Wyciagnac `formatDate()` do `src/lib/helpers.ts` — zduplikowane w `app-sidebar.tsx` i `information/page.tsx`
- [ ] Wyciagnac `getLanguageLabel()` do shared utility
- [ ] Wyciagnac `AppHeader` component — pattern powtorzony w dashboard i information

### Refaktoring panelu
- [ ] Rozbic `AppSidebar` (610 linii) na mniejsze komponenty: `use-app-colors.ts`, `use-app-order.ts`, `use-store-filter.ts`, `sortable-app-icon.tsx`, `manage-stores-dialog.tsx`
- [ ] Query keys factory — `queryKeys.apps.list()`, `queryKeys.apps.detail(id)` itp.
- [ ] Integracja Eden Treaty zamiast recznego `fetchApi<T>`
- [ ] Usunac index signature z `Listing` type — `[key: string]: string | boolean`
- [ ] Przeniesc `APP_STORE_LANGUAGES` z `types.ts` do `constants.ts`

### Refaktoring backendu
- [ ] Usunac `throw new Error("unreachable")` po `buildError()` — niespojne, `buildError` zwraca `never`
- [ ] Zamienic hardcoded languages `["en-US", "pl-PL", "de-DE"]` w assets sync na dynamiczne pobieranie
- [ ] Zamienic `require()` na ESM import w GooglePlayProvider (`google-play/index.ts:525`)
- [ ] Dodac request logging middleware
- [ ] Dodac graceful DB connection shutdown
- [ ] Wersja z `package.json` zamiast hardcoded `"0.1.0"` w system controller

### Panel cleanup
- [ ] Dodac barrel exports w hooks/ i components/
- [ ] Usunac nieuzywane SVG z `/public/` (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`)
- [ ] Usunac zduplikowane CSS variables (`:root` = `.dark`)
- [ ] Naprawic hardcoded version `"0.1.0"` w settings page — `package.json` ma `"0.5.3"`
- [ ] Dodac optimistic updates dla reorder/save operacji
- [ ] Naprawic `syncStore.isPending` blokujacy WSZYSTKIE przyciski sync naraz

## Sprint 6 — ASO Tools & Intelligence (P2)

### Phase 1: AI-Enhanced Metadata ✅ (done)
- [x] Platform-aware prompty (iOS vs Android algorytmy, 3-warstwowy system prompt)
- [x] Pole `shortDescription` (Android 80 chars) z auto-mappingiem subtitle→shortDescription
- [x] Platform field validation (keywords/promotionalText → iOS only, shortDescription → Android only)
- [x] Wzbogacony ASO context (awards, testimonials, pressQuotes, brandVoice, pricing, userLanguage)
- [x] Persona-driven instructions w user prompt (targetAudience, painPoints, userLanguage)
- [x] Keyword suggestion z semantic clusters (feature, problem, category, alternative, longTail)
- [x] Empathy framework AAAA+I w draft reply (acknowledge, appreciate, address, act, invite)

### Phase 2: Keyword Research & Tracking
- [ ] Keyword difficulty/volume estimation (integracja z AppTweak lub wlasna heurystyka)
- [ ] Rank tracking w czasie — codzienne snapshoty pozycji per keyword per locale
- [ ] Keyword gap analysis vs konkurencja — jakie keywords ma konkurent a my nie
- [ ] Seasonal keyword calendar — sugestie sezonowych keywords per kategoria
- [ ] Keyword cannibalization detection — wykrywanie overlappingu miedzy title/subtitle/keywords

### Phase 3: Competitor Analysis
- [ ] Dashboard metadata audit konkurencji — porownanie title, description, screenshots
- [ ] Creative audit — analiza screenshotow, ikon, feature graphics konkurencji
- [ ] Rating velocity tracking — tempo zmian ocen konkurencji
- [ ] Alerty na zmiany metadata konkurencji — powiadomienia o aktualizacjach
- [ ] Competitor keyword overlap matrix

### Phase 4: Review Intelligence
- [ ] Sentiment analysis (Appbot-like) — pozytywny/negatywny/neutralny per review
- [ ] Auto-tagging: bugs, feature requests, UX issues, praise, fixable/non-fixable
- [ ] Templated auto-replies z AI — gotowe szablony per kategoria problemu
- [ ] Dashboard trendu ocen — rolling average, velocity, distribution over time
- [ ] Review response rate tracking i impact on ratings

### Phase 5: ASO Audit & Score
- [ ] ASO score per listing — 0-100 na podstawie checklisty best practices
- [ ] Checklist per locale — co jest wypelnione, co brakuje, co mozna poprawic
- [ ] Benchmarki kategorii — jak wypadamy vs srednia kategorii
- [ ] Priorytetyzowane sugestie — co daje najwiekszy impact per effort

### Phase 6: A/B Testing & Performance
- [ ] CPP (Custom Product Pages, iOS) management — tworzenie i tracking wariantow
- [ ] CSL (Custom Store Listings, Android) management
- [ ] Google Play Experiments integration — A/B testy listingow
- [ ] CVR/CTR dashboard — conversion rate per listing wariant
- [ ] Screenshot caption generator AI — generowanie tekstow na screenshoty

### Phase 7: Localization Intelligence
- [ ] Super Geo Localization strategy — lokalizacja per rynek (nie tylko per jezyk)
- [ ] Lokalizowany keyword research (native keywords, nie tlumaczenie)
- [ ] Performance dashboard per locale — CVR, impressions, downloads per kraj/jezyk
- [ ] Translation quality scoring — porownanie AI vs native tlumaczy

### Narzedzia zewnetrzne do integracji

| Narzedzie | Co daje | Priorytet | Phase |
|-----------|---------|-----------|-------|
| AppTweak API | Keywords, competitor, ranking, difficulty | Wysoki | 2, 3 |
| Appbot | Review analytics, sentiment, auto-tagging | Sredni | 4 |
| Google Play Console API | A/B tests, Vitals, metrics | Wysoki | 6 |
| App Store Connect API | CPP, metrics, keywords | Wysoki (czesciowo zrobione) | 6 |
| Google Trends API | Seasonal data, trending topics | Niski | 2 |
| SensorTower/data.ai API | Market data, category benchmarks | Sredni | 5 |

# ASO — Zaawansowane strategie i deep dive (2026)

> Rozszerzony research: algorytmy rankingowe, Custom Product Pages, In-App Events, sezonowość, analiza konkurencji, Apple Search Ads synergy, retencja, ikony.

---

## Spis treści

1. [Algorytm rankingowy — jak naprawdę działa](#1-algorytm-rankingowy)
2. [Retencja i jakość użytkowników](#2-retencja-i-jakość-użytkowników)
3. [Custom Product Pages & Custom Store Listings](#3-custom-product-pages)
4. [In-App Events & Promotional Content](#4-in-app-events--promotional-content)
5. [Apple Search Ads + ASO Synergy](#5-apple-search-ads--aso-synergy)
6. [Analiza konkurencji — deep dive](#6-analiza-konkurencji)
7. [Sezonowe ASO — kalendarz i taktyki](#7-sezonowe-aso)
8. [Ikona aplikacji — zaawansowany design](#8-ikona-aplikacji)
9. [Rating Prompt Strategy](#9-rating-prompt-strategy)
10. [Narzędzia ASO](#10-narzędzia-aso)

---

## 1. Algorytm rankingowy

### Apple App Store — czynniki rankingowe (waga malejąca):

| Czynnik | Waga | Opis |
|---------|------|------|
| **Tytuł + Podtytuł** | Najwyższa | Najsilniej ważone pola tekstowe dla keyword relevance |
| **Keyword Field** | Wysoka | 100 znaków, uzupełnia tytuł/podtytuł |
| **Download Velocity** | Wysoka | Prędkość pobrań w czasie — silny sygnał |
| **Conversion Rate** | Wysoka | % wyświetleń → instalacja |
| **Retencja D7/D30** | Wysoka | Retencja na 7. i 30. dzień — **większa waga niż CTR** |
| **Oceny i recenzje** | Wysoka | Poniżej 3.5★ = "znacząco obniżona widoczność"; 4.0+ koreluje z lepszym rankingiem |
| **Uninstall rate** | Wysoka | Szybka deinstalacja = negatywny wpływ **silniejszy niż niska ocena** |
| **Session length / DAU** | Średnia | Długość sesji, aktywni użytkownicy dzienni |
| **Crash rate** | Średnia | Niestabilne wydania → spadek ocen → spadek konwersji → spadek rankingu |
| **Update frequency** | Średnia | Regularne aktualizacje (co 2-4 tygodnie) sygnalizują aktywny rozwój |
| **In-App Events** | Niska-Średnia | Indeksowane w search, dodatkowa widoczność |
| **Screenshot captions** | Nowa! | Niektóre napisy na screenach są teraz uwzględniane w rankingu |
| **Revenue** | Pośrednia | Wpływ przez engagement metrics |

### Google Play — czynniki rankingowe:

| Czynnik | Waga | Różnica vs iOS |
|---------|------|---------------|
| **Tytuł** | Najwyższa | Tak samo jak iOS |
| **Krótki opis** | Wysoka | iOS nie ma tego pola |
| **Długi opis** | Średnia | **Indeksowany** (iOS NIE indeksuje opisu!) |
| **Download velocity** | Wysoka | Tak samo |
| **Oceny i recenzje** | Wysoka | Sentiment analysis, review velocity |
| **Retencja / engagement** | Wysoka | DAU, session freq/length, uninstall rate |
| **Android Vitals** | Wysoka | Crash rate, ANR rate, battery, load time — **penalizacja za złe wyniki** |
| **Backlinks** | Niska | Google indexuje linki do listingu z webu |
| **Lokalizacja** | Średnia | Zlokalizowane apps dostają boost w danym regionie |
| **Update frequency** | Średnia | Regularne aktualizacje = pozytywny sygnał |

### Kluczowy insight 2026:

> **Ranking w 2026 to mniej "kto najlepiej napcha keywords", a bardziej "kto udowodni na dużą skalę, że prawdziwi użytkownicy chcą aplikacji, lubią ją i ją trzymają."**

### Hierarchia ważności (od najważniejszej):
```
1. Produkt (retencja, engagement, jakość)
2. Metadata (tytuł, keywords, opis)
3. Konwersja (screenshoty, ikona, opis)
4. Wolumen (downloads, velocity)
5. Social proof (oceny, recenzje)
6. Sygnały zewnętrzne (ads, editorial, linki)
```

---

## 2. Retencja i jakość użytkowników

### Dlaczego retencja jest teraz ważniejsza niż kiedykolwiek:

- **Retencja D7/D30 ma większą wagę niż CTR** w algorytmie
- Szybka deinstalacja ma **bardziej negatywny wpływ niż niska ocena gwiazdkowa**
- Sklepy nagradzają aplikacje, które użytkownicy **trzymają i z których korzystają**

### Metryki retencji wpływające na ranking:

| Metryka | Opis | Wpływ |
|---------|------|-------|
| **D1 Retention** | % użytkowników wracających po 1 dniu | Wczesny sygnał jakości |
| **D7 Retention** | % po 7 dniach | Silny sygnał — wyżej niż CTR |
| **D30 Retention** | % po 30 dniach | Kluczowy long-term sygnał |
| **Session frequency** | Jak często otwierają app | Engagement metric |
| **Session length** | Jak długo spędzają w app | Zaangażowanie |
| **Uninstall rate** | % deinstalacji po instalacji | Negatywny sygnał |
| **Churn rate** | % użytkowników odchodzących w danym okresie | Trend quality |

### Co to oznacza dla ASO:

1. **Nie generuj fałszywych instalacji** — boty/incentivized installs → szybka deinstalacja → penalizacja
2. **Targetuj właściwych użytkowników** — CPP/CSL dopasowane do intencji → lepszy product-market fit → lepsza retencja
3. **Nie obiecuj w listingu tego czego nie dostarczasz** — mismatch expectation → deinstalacja → spadek rankingu
4. **Onboarding jest częścią ASO** — dobry onboarding → lepsza retencja → lepszy ranking
5. **Monitoruj Android Vitals** — crash rate, ANR, battery → penalizacja za złe wyniki

### Feedback loop:
```
Lepszy listing → Właściwi użytkownicy → Lepsza retencja → Wyższy ranking → Więcej widoczności → Więcej właściwych użytkowników
```

---

## 3. Custom Product Pages

### Apple — Custom Product Pages (CPP):

| Element | Szczegóły |
|---------|-----------|
| **Max liczba** | 70 CPP na aplikację (zwiększone z 35, październik 2025) |
| **Co można customizować** | Screenshoty, wideo, promotional text, deep links |
| **Czego NIE można zmienić** | Tytuł, opis, ikona (stałe z default page) |
| **Lokalizacja** | Pełna per region |
| **Organic search** | Od lipca 2025 — CPP pojawiają się w **organicznych wynikach** wyszukiwania! |

### Przełom 2025 — CPP w organic search:

- Przypisz keywords z keyword field do konkretnych CPP
- Gdy app rankuje na te keywords, CPP może **zastąpić default page** w wynikach
- Każda kombinacja keywords musi być **unikalna** dla jednego CPP
- App Store Connect pokazuje search impressions per CPP

### Strategiczne use cases:

| Strategia | Przykład |
|-----------|---------|
| **Feature-based** | Aplikacja designerska: osobny CPP na "photo editor", "background remover", "AI filters" |
| **Audience-based** | Fitness: CPP dla "strength training" (mężczyźni), CPP dla "yoga" (kobiety) |
| **Language-based** | App do nauki języków: CPP z obrazkami zabytków Paryża dla "learn French" |
| **Seasonal** | CPP na Black Friday z promocjami w pierwszym screenshocie |
| **Campaign-aligned** | CPP dopasowane do kreacji reklamowych (Facebook → CPP z tym samym messaging) |

### Wydajność:

| Segment | Wzrost konwersji |
|---------|-----------------|
| Gry | +8% CVR |
| Non-gaming | +6.6% CVR |
| Generic campaigns | do +8.6% CVR |
| SoundCloud (keyword campaigns) | **+58% CVR**, -39% CPI |
| CBS Sports | +20% konwersji |

### Google Play — Custom Store Listings (CSL):

| Element | Szczegóły |
|---------|-----------|
| **Max liczba** | 50 CSL |
| **Co można customizować** | Tytuł, opis, ikona, screenshoty, wideo — **więcej niż Apple!** |
| **Deep links** | Działają tylko dla użytkowników z już zainstalowaną app |
| **Targeting** | Kraj, UTM source, installed state |

### Best practices CPP/CSL:

1. **Ad → CPP alignment** — messaging reklamy musi matchować CPP, inaczej drop-off po kliknięciu
2. **Pierwszy screenshot = najważniejszy** — często jedyna rzecz którą user widzi
3. **Jedno jasne CTA** — nie kilka na jednej stronie
4. **Testuj systematycznie** — jeden wariant na raz
5. **Nie twórz CPP na każdy minor feature** — skup się na high-impact wariantach
6. **Cross-team collaboration** — ASO + UA + kreacja muszą współpracować

---

## 4. In-App Events & Promotional Content

### Apple — In-App Events:

**Typy eventów (badges):**

| Badge | Opis | Przykład |
|-------|------|---------|
| Challenge | Cel do osiągnięcia w timeframe | "30-day fitness challenge" |
| Competition | Rywalizacja z innymi | "Weekly leaderboard" |
| Live Event | Real-time doświadczenie | "Live Q&A with CEO" |
| Major Update | Znaczący nowy feature | "AI-powered search is here" |
| New Season | Nowy cykl contentu | "Season 3 available now" |
| Premiere | Premiera contentu | "New course: Advanced ASO" |
| Special Event | Inne unikalne momenty | "Anniversary celebration" |

**Limity i wymagania:**

| Element | Limit |
|---------|-------|
| Max zatwierdzonych eventów | 15 |
| Max live jednocześnie | 10 |
| Czas trwania | 15 min – 31 dni |
| Publikacja przed startem | Do 14 dni |
| Event Name | max 30 znaków (searchable!) |
| Short Description | max 50 znaków |
| Long Description | max 120 znaków |

**Wymagania graficzne:**

| Element | Rozmiar | Format |
|---------|---------|--------|
| Event Card | 1920×1080 (16:9, landscape) | JPG/PNG/Video |
| Details Page | 1080×1920 (9:16, portrait) | JPG/PNG/Video |

**Gdzie się pojawiają:**
- Na product page
- **W wynikach wyszukiwania** (pod listingiem — app pojawia się dwukrotnie!)
- Today tab, Apps tab, Games tab (edytorialnie kuratowane)

**Apple odrzuca eventy które:**
- Promują ongoing/powtarzalne aktywności
- Skupiają się wyłącznie na zniżce bez nowego contentu
- Mają generyczny/niejasny opis

### Google Play — Promotional Content (LiveOps):

**Typy:**

| Typ | Opis | Wymaganie |
|-----|------|----------|
| Offers | Zniżki, bundle, free rewards, trial | Min 10% wartości |
| Time-Limited Events | Konkursy, wyzwania, live stream | Ograniczone czasowo |
| Major Updates | Nowe features, rozszerzenia | Znaczące zmiany |

**Wymagania:**

| Element | Limit |
|---------|-------|
| Tagline | max 80 znaków |
| Description | max 500 znaków |
| Image | 1920×1080 (16:9), JPG/PNG |
| Video | YouTube link, landscape |
| Approval time | min 4 dni |
| Featuring request | 14-30 dni przed |

**Targeting:**
- Everyone (istniejący + potencjalni)
- Potential users only
- Specific segments (churned, lapsed, buyers)

**Wyniki wg Google:**
- **+2% MAU** (monthly active users)
- **+4% revenue** vs developers bez promotional content

### Strategia eventów:

1. **Planuj 2-3 miesiące naprzód** — szczególnie na główne sezony
2. **Lokalizuj metadane** — Apple NIE tłumaczy automatycznie
3. **Deep links muszą działać** — testuj przed submission
4. **Specyficzne, action-oriented opisy** — nie "Something exciting is coming"
5. **Align z sezonem** — eventy dopasowane do kalendarza sezonowego
6. **Odświeżaj regularnie** — co 2 tygodnie nowy event = ciągła widoczność

---

## 5. Apple Search Ads + ASO Synergy

### Growth Loop:

```
ASO (organiczna widoczność)
  ↓ lepsze metadata → wyższy Quality Score w Ads
  ↓ niższy CPT (cost per tap)
Apple Search Ads (paid)
  ↓ zwiększone installe → wyższy download velocity
  ↓ lepszy organic ranking
ASO (wyższy organic ranking)
  ↓ więcej organicznych instalacji
  → FEEDBACK LOOP
```

### Jak Ads pomagają ASO:

| Mechanizm | Opis |
|-----------|------|
| **Keyword discovery** | Ads Discovery campaigns ujawniają keywords o wysokiej konwersji → dodaj do metadata |
| **Download velocity** | Paid installe zwiększają velocity → boost organic ranking |
| **Conversion data** | Ads pokazują które keywords konwertują → optymalizuj metadata |
| **Quality Score** | Dobre ASO → wyższy relevance score → niższy CPT w Ads |
| **CPP integration** | Łącz Ad Groups z konkretnym CPP dla message alignment |

### Zmiana marzec 2026:

> Apple rozszerza liczbę slotów reklamowych w wynikach wyszukiwania App Store — wiele płatnych reklam będzie się pojawiać **w całych wynikach**, nie tylko na górze.

**Implikacje:**
- Większa konkurencja między paid i organic
- Konieczna strategiczna koordynacja ASO + Ads
- Monitoruj share of voice (SOV) organic vs paid
- Budget allocation musi uwzględniać oba kanały

### Strategia synergii:

1. **Discovery Campaign** → zbieraj keyword data → aktualizuj ASO metadata
2. **Exact Match Campaign** → targetuj top keywords z ASO → boost velocity
3. **Brand Defense** → licytuj na swoją markę → blokuj konkurencję
4. **Competitor Keywords** → licytuj na keywords konkurencji + CPP dopasowane
5. **CPP + Ad Groups** → każda grupa reklam → dedykowany CPP → aligned messaging

---

## 6. Analiza konkurencji

### Framework analizy konkurencji:

#### Krok 1: Identyfikacja konkurentów

| Typ | Jak znaleźć |
|-----|-------------|
| Bezpośredni | Te same keywords, ta sama kategoria |
| Pośredni | Rozwiązują ten sam problem inaczej |
| Aspiracyjni | Top apps w twojej kategorii |

#### Krok 2: Metadata Audit

| Element do analizy | Co sprawdzić |
|--------------------|-------------|
| Tytuł | Keywords użyte, struktura |
| Podtytuł / Short desc | USP positioning |
| Opis | Struktura, keywords, tone |
| Keywords (iOS) | Narzędzia spy (AppTweak, Astro) |
| What's New | Częstotliwość aktualizacji, focus |

#### Krok 3: Creative Audit

| Element | Co sprawdzić |
|---------|-------------|
| Ikona | Kolory, styl, trend w kategorii |
| Screenshoty | Struktura, captions, storytelling |
| Wideo | Czy mają, jak długie, co pokazują |
| CPP/CSL | Ile wariantów, na jakie keywords |

#### Krok 4: Performance Audit

| Metryka | Co sprawdzić |
|---------|-------------|
| Rating | Średnia ocena, trend, velocity |
| Recenzje | Sentiment, common complaints |
| Ranking per keyword | Pozycja vs twoja |
| Download estimates | Narzędzia estymacji |
| Update frequency | Jak często aktualizują |

#### Krok 5: Keyword Gap Analysis

```
1. Lista keywords na które rankujesz TY
2. Lista keywords na które rankują KONKURENCI
3. Gap = keywords konkurencji MINUS twoje keywords
4. Priorytetyzuj gap keywords po: relevance × volume × difficulty
5. Dodaj top gap keywords do swojej metadata
```

### Narzędzia do competitor analysis:

| Narzędzie | Co oferuje |
|-----------|-----------|
| **AppTweak** | Keyword spy, CPP Explorer, timeline zmian metadata |
| **Sensor Tower** | Download/revenue estimates, keyword rankings |
| **MobileAction** | Keyword discovery, competitor monitoring |
| **AppFollow** | Keyword Spy tab, review monitoring |
| **ASO.dev** | Ranking per keyword, downloads, revenue |
| **Astro** | Competitor keyword discovery, ranking tracking |
| **App Radar** | Keyword monitoring, competitor alerts |

### Co monitorować cyklicznie:

- [ ] Zmiany metadata konkurencji (tytuł, opis, keywords)
- [ ] Nowe screenshoty / ikony (A/B testy)
- [ ] Nowe CPP/CSL
- [ ] Rating velocity (nagły wzrost → kampania?)
- [ ] In-App Events / LiveOps
- [ ] Nowe wersje (changelog analysis)
- [ ] Paid campaigns (Apple Search Ads keywords)

---

## 7. Sezonowe ASO

### Kalendarz sezonowy — miesiąc po miesiącu:

| Miesiąc | Główne eventy | Kategorie z boostem | Co optymalizować |
|---------|--------------|---------------------|-----------------|
| **Styczeń** | Nowy Rok, postanowienia | Fitness, Health, Finance, Productivity, Education | Keywords: "new year resolution", "lose weight 2026" |
| **Luty** | Walentynki (14), Super Bowl | Dating, Social, Food delivery, Sports, Streaming | Keywords: "valentine gift", "dating app" |
| **Marzec** | Dzień Kobiet (8), Wiosna, St. Patrick | Fashion, Beauty, Health, Social media | Keywords: "women's day", "spring cleaning" |
| **Kwiecień** | Wielkanoc, Earth Day (22), Tax Season | Finance, Tax, Shopping, Eco apps | Keywords: "easter sale", "tax filing" |
| **Maj** | Dzień Matki, Memorial Day | Shopping, Gift, Travel, Photo | Keywords: "mother's day gift", "travel deals" |
| **Czerwiec** | Lato start, Dzień Ojca, Pride | Travel, Fitness outdoor, Social, Entertainment | Keywords: "summer vacation", "beach workout" |
| **Lipiec** | Wakacje, Independence Day (US) | Travel, Navigation, Language learning, Games | Keywords: "road trip", "learn language" |
| **Sierpień** | Back to School | Education, Productivity, Calendar, Note-taking | Keywords: "back to school", "study app" |
| **Wrzesień** | Back to School 2, Apple launch | Education, Productivity, Tech | Keywords: "school organizer", "new iPhone" |
| **Październik** | Halloween (31), Oktoberfest | Games, Photo editing, Social, Food | Keywords: "halloween costume", "scary games" |
| **Listopad** | Black Friday, Cyber Monday, Thanksgiving | Shopping, Finance, Deals, ALL categories | Keywords: "black friday deals", "cyber monday" |
| **Grudzień** | Boże Narodzenie, Nowy Rok, Chanuka | Shopping, Gift, Entertainment, Family games | Keywords: "christmas gift", "holiday" |

### Timeline przygotowań:

```
T-3 miesiące:  Research — analiza keywords sezonowych, benchmarking
T-2 miesiące:  Kreacja — nowe screenshoty, ikona, opisy
T-6 tygodni:   Submission — featuring request do Apple/Google
T-4 tygodnie:  A/B Test — testuj sezonowe warianty
T-2 tygodnie:  Launch — publikuj sezonowe metadata + eventy
T-0:           Event — monitoruj performance codziennie
T+1 tydzień:   Rollback — wróć do standardowych kreatywnych
```

### Real-world case studies:

| Marka | Event | Wynik |
|-------|-------|-------|
| **Best Buy** | Black Friday ASO | **+454%** wzrost pobrań |
| **Adidas** | Black Friday ASO | **+582%** wzrost pobrań |
| **Upside** | Black Friday keywords | Ranking #9 na "Black Friday" |
| **Festive icon update** | Boże Narodzenie (SplitMetrics) | **+47% conversion uplift** |

### Taktyki sezonowe:

1. **Keywords** — dodaj sezonowe keywords do metadata 2-4 tygodnie przed eventem
2. **Screenshoty** — sezonowe tło/dekoracje, ale zachowaj core branding
3. **Ikona** — subtelne zmiany (czapka Mikołaja, serduszka na walentynki) — **NIE** rewolucja
4. **Opis** — sezonowe references w promotional text (iOS) / short description (Android)
5. **In-App Events** — utwórz event dopasowany do sezonu
6. **CPP/CSL** — sezonowe warianty Custom Product Pages
7. **Ads** — zwiększ budget na sezonowe keywords

---

## 8. Ikona aplikacji

### 10 zasad zaawansowanego designu ikony:

1. **Jedna idea** — komunikuj jedną koncepcję jasno
2. **Cel aplikacji widoczny od razu** — użytkownik musi zrozumieć funkcjonalność instant
3. **Spójność z UI** — ikona musi odzwierciedlać to co jest w środku
4. **Strategiczne kolory marki** — dominant color = brand + kategoria
5. **Unikaj tekstu** — pixeluje na małych rozmiarach, problemy z lokalizacją
6. **Logo tylko dla silnych marek** — nieznane logo nie komunikuje wartości
7. **Sezonowe warianty** — subtelne zmiany na święta → sygnał aktywności
8. **Lokalizuj dla kluczowych rynków** — kulturowe niuanse wpływają na konwersję
9. **Badaj, potem wyróżniaj się** — sprawdź trendy w kategorii, potem złam wzorzec
10. **A/B testuj ciągle** — nawet subtelne tweaki → double-digit improvements

### Wymagania techniczne:

| Platforma | Rozmiar | Format | Uwagi |
|-----------|---------|--------|-------|
| iOS | 1024×1024 px | PNG | System dodaje rounded corners |
| iOS 26 (Liquid Glass) | 1024×1024 px | Layered PNG | Blur, głębia, refrakcja światła |
| Android | 512×512 px | PNG | Full bleed, bez cieni |
| watchOS | Circular | PNG | Kształt koła |

### Trendy 2026:

- **iOS 26 Liquid Glass** — ikony warstwowe z efektami blur i głębi — "największy upgrade UI od iOS 7"
- **Dark mode first** — ciemne ikony wyróżniają się w morzu jasnych
- **Minimalizm** — mniej elementów, więcej impact
- **Gradient revival** — subtletne gradienty wracają
- **Character-first** (gry) — główna postać prominentna

### A/B testing ikon — framework:

```
1. Baseline: obecna ikona (kontrola)
2. Wariant A: zmiana koloru tła
3. Wariant B: zmiana głównego elementu
4. Użyj A/B/B testing (dwa warianty vs kontrola) — zapobiega false positives
5. Mierz: CVR (conversion rate), CTR, install rate
6. Min 7 dni, statystycznie istotna próbka
7. Zwycięzca → nowa baseline → nowy test
```

**Case study:** AppQuantum osiągnął **+21.5% wzrost instalacji** przez A/B testing ikon gier mobilnych.

---

## 9. Rating Prompt Strategy

### Kiedy prosić o ocenę (optimal timing):

| Moment | Dlaczego działa | Przykład |
|--------|----------------|---------|
| **Po ukończeniu zadania** | Satysfakcja z osiągnięcia | Po zakończeniu workoutu |
| **Po osiągnięciu milestone'u** | Poczucie progresu | "Ukończyłeś 10. lekcję!" |
| **Po pozytywnym wyniku** | Dobry nastrój | Po zapisaniu budżetu |
| **Po X sesjach** | Engaged user | Po 5. sesji w app |
| **Po zakupie** | Investment = commitment | Po subskrypcji |

### Kiedy NIE prosić:

| Moment | Dlaczego nie |
|--------|-------------|
| Po crashu / błędzie | Frustracja → niska ocena |
| W trakcie krytycznego zadania | Przerwanie flow → irytacja |
| Przy pierwszym uruchomieniu | Brak doświadczenia z app |
| Po odmowie poprzedniej prośby | Spamming → negatywna percepcja |
| W trakcie onboardingu | Za wcześnie, brak wartości |

### Implementacja:

| Platforma | API | Limit |
|-----------|-----|-------|
| iOS | `SKStoreReviewController` | Max 3 razy na 365 dni |
| Android | Play In-App Review API | Quota zarządzana przez Google |

### Strategia recenzji:

1. **Odpowiadaj na WSZYSTKIE recenzje** — pozytywne i negatywne
2. **Negatywne → szybko** — pokaż że słuchasz
3. **Pozytywne → podziękowanie** — buduj relację
4. **Adresuj feedback w aktualizacjach** — "Naprawiliśmy problem zgłoszony przez Was"
5. **Monitoruj sentiment** — narzędzia AI do analizy trendów
6. **Cel: 4.0+★** — poniżej 4★ "often struggle to gain traction"

---

## 10. Narzędzia ASO

### Kompleksowe platformy:

| Narzędzie | Główne feature | Cena |
|-----------|---------------|------|
| **AppTweak** | Keywords, competitor, timeline, CPP Explorer, localization | Od $69/mies |
| **Sensor Tower** | Downloads/revenue estimates, keyword rankings | Enterprise |
| **MobileAction** | Keyword discovery, competitor, market intelligence | Od $59/mies |
| **data.ai** (ex-App Annie) | Market data, competitor analysis, estimates | Enterprise |
| **AppFollow** | Reviews, keyword spy, ASO monitoring | Od $111/mies |

### Specjalistyczne narzędzia:

| Narzędzie | Specjalizacja |
|-----------|--------------|
| **SplitMetrics** | A/B testing iOS (CPP, ikony, screenshoty) |
| **StoreMaven** | A/B testing + creative intelligence |
| **ASO.dev** | Keywords, ranking tracking |
| **Astro** | Competitor keyword spy |
| **App Radar** | ASO workflow, keyword monitoring |
| **AppTamin** | App preview video production |
| **The ASO Project** | CRO agency + screenshot design |

### Free narzędzia:

| Narzędzie | Co daje |
|-----------|---------|
| **Google Play Console** | Store Listing Experiments, Android Vitals |
| **App Store Connect** | CPP, Product Page Optimization |
| **Google Trends** | Seasonal keyword trends |
| **ChatGPT / Claude** | Keyword brainstorming, description writing |

---

## Źródła

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

# Wymagane dane o aplikacji do generowania ASO contentu

> Jakie informacje zbieramy od użytkownika, żeby AI mogło wygenerować dobre opisy, keywords, napisy na screenshoty i cały listing.

---

## Struktura: Required → Optional

```
REQUIRED (bez tego nie napiszemy nic sensownego)
  └── Core Info — 5-7 pytań, ~2 minuty

OPTIONAL (lepszy output, ale nie blokuje generowania)
  ├── Audience & Positioning — persona, konkurencja
  ├── Tone & Branding — styl komunikacji
  ├── Advanced Keywords — ręczne keywords, wykluczenia
  └── Seasonal & Campaign — sezonowe potrzeby
```

---

## REQUIRED — Obowiązkowe informacje

> Minimum potrzebne do wygenerowania sensownego listingu. Bez tych danych nie da się pisać.

### 1. Podstawowe info o aplikacji

| Pole | Typ | Opis | Przykład |
|------|-----|------|---------|
| **app_name** | string | Nazwa aplikacji (brand) | "Calm" |
| **platform** | enum | `ios` / `android` / `both` | "both" |
| **category** | string | Główna kategoria w store | "Health & Fitness" |
| **one_liner** | string (max 120 chars) | Jedno zdanie — co robi aplikacja | "Meditation and sleep app that helps you reduce stress and sleep better" |

### 2. Problem i wartość

| Pole | Typ | Opis | Przykład |
|------|-----|------|---------|
| **problem** | string | Jaki problem rozwiązuje? Co boli użytkownika? | "Users struggle with stress, anxiety, and poor sleep quality" |
| **main_benefit** | string | Główna korzyść — co użytkownik ZYSKUJE | "Fall asleep faster and feel calmer throughout the day" |
| **key_features** | string[] (3-5) | Lista kluczowych funkcji (krótko, po 5-10 słów) | ["Guided meditations for beginners", "Sleep stories narrated by celebrities", "Breathing exercises for anxiety", "Daily calm 10-min session"] |

### 3. Wyróżniki

| Pole | Typ | Opis | Przykład |
|------|-----|------|---------|
| **differentiator** | string | Co wyróżnia od konkurencji? Dlaczego ta app, a nie inna? | "Largest library of sleep stories, narrated by Matthew McConaughey and others" |

### 4. Język

| Pole | Typ | Opis | Przykład |
|------|-----|------|---------|
| **languages** | string[] | Dla jakich języków/rynków generować | ["en", "pl", "de", "es"] |

---

**Razem required: 8 pól.** Użytkownik wypełnia formularz w ~2 minuty i dostaje:
- Tytuł + podtytuł (iOS) / krótki opis (Android)
- Długi opis (4000 znaków)
- Sugestie keywords (iOS keyword field)
- Napisy na screenshoty (8-10 propozycji)

---

## OPTIONAL — Dodatkowe informacje

> Każda dodatkowa sekcja **poprawia jakość** generowanego contentu, ale NIE jest wymagana.

### A. Grupa docelowa (Audience)

| Pole | Typ | Opis | Przykład |
|------|-----|------|---------|
| **target_audience** | string | Kto jest idealnym użytkownikiem? | "Busy professionals aged 25-45 who struggle with work-life balance" |
| **user_persona_name** | string | Opcjonalnie: nazwij personę | "Stressed Sarah" |
| **pain_points** | string[] | Szczegółowe problemy użytkowników (3-5) | ["Can't fall asleep", "Anxiety during meetings", "No time for self-care"] |
| **user_language** | string | Jak użytkownicy opisują swój problem? (ich słowa) | "I just can't turn off my brain at night" |

**Wpływ:** Opis bardziej trafia w potrzeby, keywords bliższe językowi użytkowników.

**Przykład pełnej persony (fitness app):**
```
Persona: "Fitness Fiona"
- Wiek: 30 lat, kobieta, pracownik biurowy
- Problem: ceni wellness ale nie ma czasu na ćwiczenia przez napięty harmonogram
- Szuka: szybkich treningów w domu, guided sessions, personalizowanych planów
- Keywords wynikające z persony: "lazy workout", "home fitness", "15-minute workout", "women workout"
- Screenshot messaging: "Quick 15-min workouts" > "Workout tracker"
- CPP/CSL: osobna strona z obrazkami treningów w domu, captions "No gym needed"
```

> **Tip**: Persona powinna informować WSZYSTKIE aspekty ASO — od wyboru keywords, przez captions na screenshotach, po CPP/CSL targeting.

### B. Konkurencja i pozycjonowanie

| Pole | Typ | Opis | Przykład |
|------|-----|------|---------|
| **competitors** | string[] (1-5) | Nazwy głównych konkurentów | ["Headspace", "Insight Timer", "Balance"] |
| **competitive_advantage** | string | Szczegółowo: czym wygrywasz? | "More content variety + celebrity narrators + no commitment required" |
| **positioning** | enum | Jak się pozycjonujesz? | "premium" / "value" / "freemium" / "niche" |

**Wpływ:** Wyróżniające opisy, unikanie tych samych keywords co konkurencja, keyword gap analysis.

### C. Ton i branding

| Pole | Typ | Opis | Przykład |
|------|-----|------|---------|
| **tone** | enum / string | Ton komunikacji | "calm_friendly" / "professional" / "playful" / "authoritative" / custom |
| **brand_voice_examples** | string | Przykład zdania w stylu marki | "Take a deep breath. We've got you." |
| **words_to_avoid** | string[] | Słowa/frazy których NIE używać | ["addictive", "cheap", "hustle"] |
| **words_to_include** | string[] | Słowa/frazy które MUSZĄ się pojawić | ["science-backed", "free trial"] |

**Wpływ:** Spójny ton w opisach, napisy na screenshotach w stylu marki.

### D. Social proof i osiągnięcia

| Pole | Typ | Opis | Przykład |
|------|-----|------|---------|
| **download_count** | string | Liczba pobrań (przybliżona) | "10M+" |
| **rating** | number | Średnia ocena | 4.8 |
| **rating_count** | string | Liczba ocen | "500K+" |
| **awards** | string[] | Nagrody, wyróżnienia | ["Apple App of the Year 2024", "Google Play Editor's Choice"] |
| **press_quotes** | string[] | Cytaty z mediów | ["'The #1 app for sleep' — The New York Times"] |
| **testimonials** | string[] | Cytaty użytkowników | ["'Changed my life. I sleep 2 hours more now.' ★★★★★"] |

**Wpływ:** Social proof w opisach i na screenshotach, budowanie zaufania.

### E. Szczegóły produktu

| Pole | Typ | Opis | Przykład |
|------|-----|------|---------|
| **pricing_model** | enum | Model cenowy | "freemium" / "subscription" / "one_time" / "free_with_ads" |
| **price** | string | Cena (jeśli dotyczy) | "$69.99/year or $14.99/month" |
| **free_features** | string[] | Co dostępne za darmo | ["7-day beginner course", "Daily Calm", "3 sleep stories"] |
| **premium_features** | string[] | Co w wersji premium | ["Full library 1000+ meditations", "Masterclasses", "Offline access"] |
| **supported_devices** | string[] | Urządzenia | ["iPhone", "iPad", "Apple Watch", "Android"] |

**Wpływ:** Lepszy opis modelu cenowego, przekonujący pitch free vs premium.

### F. Keywords (zaawansowane)

| Pole | Typ | Opis | Przykład |
|------|-----|------|---------|
| **must_include_keywords** | string[] | Keywords które MUSZĄ być uwzględnione | ["meditation", "sleep", "anxiety"] |
| **exclude_keywords** | string[] | Keywords do wykluczenia | ["hypnosis", "ASMR"] |
| **long_tail_keywords** | string[] | Specyficzne frazy long-tail | ["meditation for beginners", "sleep sounds for babies"] |
| **seasonal_keywords** | string[] | Sezonowe keywords (jeśli aktualne) | ["new year meditation", "stress relief holidays"] |

**Wpływ:** Precyzyjniejszy keyword field, lepiej dopasowane opisy.

### G. Sezonowość i kampanie

| Pole | Typ | Opis | Przykład |
|------|-----|------|---------|
| **current_campaign** | string | Aktualna kampania/event | "New Year 'Fresh Start' campaign" |
| **seasonal_theme** | string | Sezonowy motyw | "Winter wellness" |
| **promotion** | string | Aktualna promocja | "50% off annual subscription" |
| **cta_override** | string | Custom CTA zamiast domyślnego | "Start your 30-day free journey" |

**Wpływ:** Sezonowo dopasowany listing, promotional text, eventy.

---

## Mapowanie: dane → output ASO

| Generowany element | Required fields | Optional fields (poprawiają jakość) |
|-------------------|----------------|-------------------------------------|
| **Tytuł** (30 chars) | app_name, one_liner | must_include_keywords, competitors |
| **Podtytuł** (iOS, 30 chars) | main_benefit, key_features | tone, competitive_advantage |
| **Krótki opis** (Android, 80 chars) | one_liner, main_benefit | must_include_keywords, tone |
| **Keyword field** (iOS, 100 chars) | key_features, one_liner, category | competitors, must/exclude keywords, long_tail |
| **Długi opis** (4000 chars) | problem, main_benefit, key_features, differentiator | ALL optional — każde pole poprawia jakość |
| **Napisy na screenshoty** | key_features, main_benefit | tone, brand_voice, social_proof, pain_points |
| **Promotional text** (iOS) | main_benefit | current_campaign, promotion, seasonal_theme |
| **What's New** | key_features | tone |
| **In-App Event metadata** | one_liner | seasonal_theme, promotion, campaign |

---

## UX Flow — jak zbierać dane

### Krok 1: Quick Setup (required, ~2 min)
```
"Opowiedz nam o swojej aplikacji"

[Nazwa aplikacji]        ← text input
[Platforma]              ← toggle: iOS / Android / Obie
[Kategoria]              ← dropdown z kategoriami App Store/Google Play
[Co robi Twoja app?]     ← textarea, max 120 chars, placeholder: "Jedno zdanie opisujące Twoją aplikację"
[Jaki problem rozwiązuje?] ← textarea, placeholder: "Z czym zmagają się Twoi użytkownicy?"
[Główna korzyść]         ← textarea, placeholder: "Co zyskuje użytkownik? Jaki rezultat?"
[3-5 kluczowych funkcji] ← multi-input, add/remove, placeholder: "np. Guided meditations for beginners"
[Co Was wyróżnia?]       ← textarea, placeholder: "Dlaczego ktoś powinien wybrać Waszą aplikację?"
[Języki]                 ← multi-select z flagami
```

→ **Generuj** podstawowy listing.

### Krok 2: Enhance (optional, expandable sections)

```
"Chcesz lepszy wynik? Dodaj więcej kontekstu"

[▸ Grupa docelowa]       ← collapsed section
[▸ Konkurencja]          ← collapsed section
[▸ Ton i branding]       ← collapsed section
[▸ Social proof]         ← collapsed section
[▸ Szczegóły produktu]   ← collapsed section
[▸ Keywords]             ← collapsed section
[▸ Kampania sezonowa]    ← collapsed section
```

Każda sekcja jest **zwijana** i opcjonalna. Użytkownik rozwija tylko te, które chce wypełnić.

→ **Regeneruj** listing z uwzględnieniem dodatkowych danych.

### Krok 3: Review & Edit

```
AI generuje:
├── Tytuł + Podtytuł
├── Krótki opis (Android)
├── Długi opis
├── Keywords (iOS)
├── 8-10 propozycji captionów na screenshoty
└── Promotional text (opcjonalnie)

Użytkownik może:
├── Edytować każdy element inline
├── Regenerować pojedynczą sekcję
├── Zmienić ton/styl i regenerować
└── Eksportować / kopiować do ASC/GPC
```

---

## Walidacja pól

| Pole | Walidacja |
|------|----------|
| app_name | required, 1-30 chars |
| platform | required, enum |
| category | required, z listy App Store / Google Play |
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

## Priorytety implementacji

| Faza | Co implementujemy | Dane |
|------|------------------|------|
| **MVP** | Generowanie opisu + keywords | Required only (8 pól) |
| **v1.1** | Audience + Competitors + Tone | + sekcje A, B, C |
| **v1.2** | Social proof + Product details | + sekcje D, E |
| **v1.3** | Advanced keywords + Seasonal | + sekcje F, G |
| **v2.0** | Auto-fill z App Store/Google Play scraping | Wiele pól automatycznie |

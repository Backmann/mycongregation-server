# Internationalization (i18n) Architecture

**Status:** Design (not yet implemented).
**Last updated:** 2026-05-13.
**Owner:** @Backmann.

## Goals

`mycongregation` must support multiple languages because Jehovah's Witnesses
congregations exist in many countries, and many congregations operate in
a language different from their host country (e.g. a Russian-speaking
congregation in Germany).

Initial target languages: **Russian (`ru`), English (`en`), German (`de`)**.

The system distinguishes three independent concerns:

- **UI translation** — what the user sees (menu labels, buttons, errors)
- **Meeting content language** — the language of imported JW publications
  (EPUB files), which IS NOT translated by us
- **Locale-aware formatting** — dates, numbers, plurals per user's preference

A user with `de` UI preference may belong to a Russian-speaking congregation
that imports Russian EPUBs. Their menu is in German, but program content
(part titles, scripture references) stays in Russian.

This document defines the canonical approach for all three concerns.

## Three Layers of i18n

    Layer A: App UI Translation
      All UI strings (labels, buttons, errors) are translatable.
      Stored as per-component STR dictionaries.
      Selected by User.uiLanguage.

    Layer B: EPUB Parser Language Support
      Server's MWB and Watchtower parsers accept EPUB files in any
      supported language. Language detection from filename (JW
      conventions). Language-specific parser dictionaries.

    Layer C: Locale-aware Formatting
      Dates, numbers, plurals use the Intl API with the user's
      UI locale. No external dependencies.

Each layer has independent failure modes and is designed and implemented
separately.

## Layer A: App UI Translation

### Pattern

Use per-component `STR` dictionaries. This pattern is proven in
`30sec.org` and avoids the dependency footprint of full i18n libraries
like `i18next`.

Example:

    const STR = {
      ru: {
        title: 'Месячный отчёт',
        save: 'Сохранить',
        bibleStudies: 'Изучений Библии',
      },
      en: {
        title: 'Monthly report',
        save: 'Save',
        bibleStudies: 'Bible studies',
      },
      de: {
        title: 'Monatsbericht',
        save: 'Speichern',
        bibleStudies: 'Bibelstudien',
      },
    };

A simple hook reads the current `User.uiLanguage` and returns the
right sub-dictionary:

    const t = useTranslations(STR);
    <Text>{t.title}</Text>

### Language selection at user creation

The user's UI language lives in `User.uiLanguage` on the User entity.
Default at user creation:

1. If the client provides `Accept-Language` header matching a supported
   language, use that.
2. Otherwise, fall back to the congregation's meeting language.
3. Otherwise, fall back to `ru` (system default).

The user can change their UI language anytime via Profile settings.
The change is persisted to the server and applied on next page load.

### Translation file organization

Each screen or component owns its STR object inline. Common shared
strings (like "Save", "Cancel", "Confirm") live in `lib/i18n/common.ts`.

For larger surfaces (Schedule, Publishers), STR objects can live in
dedicated files such as `app/(app)/schedule/strings.ts`.

### Missing translation policy

If a key is missing for the current language, fall back to `en`, then
to `ru`. Never show the literal key (no `serviceReport.title.bibleStudies`
leaking into UI). A `console.warn` flags missing keys in development.

## Layer B: EPUB Parser Language Support

### JW filename conventions

JW EPUB publications follow strict naming. The language is encoded as
a single letter in the filename:

| Letter code | Language | Example |
|-------------|----------|---------|
| `U` | Russian | `mwb_U_202605.epub` |
| `E` | English | `mwb_E_202605.epub` |
| `X` | German | `mwb_X_202605.epub` |
| `F` | French | `mwb_F_202605.epub` (future) |
| `S` | Spanish | `mwb_S_202605.epub` (future) |

Mapping in code:

    const JW_LANG_CODE_TO_ISO = {
      U: 'ru',
      E: 'en',
      X: 'de',
      F: 'fr',
      S: 'es',
    } as const;

### Implementation notes from empirical EPUB inspection

Two important findings from inspecting real English EPUBs that affect
parser design across all languages:

1. **Curly apostrophes (Unicode U+2019).** JW publications consistently
   use the typographic apostrophe `'` (U+2019), not ASCII `'`. Section
   markers like `TREASURES FROM GOD'S WORD` must be stored with the exact
   Unicode character (use `\u2019` in code). Do not rely on ASCII
   apostrophe matching.

2. **Watchtower 2-month publication lag.** The Watchtower Study Edition
   is published roughly two months before the weeks it covers. For
   example, `w_E_202603.epub` (March 2026 publication) contains study
   material for meetings held in May-June 2026. The parser must
   distinguish the publication date (encoded in filename) from the
   meeting study dates (parsed from each week's header). This applies
   across all languages.

3. **Grammar differences across languages.** Week range formatting is
   not just translated words — the token order differs. English MWB
   uses `MAY 4-10` (uppercase month first, then range, no year), while
   Russian uses `11-17 мая` (range first, lowercase month last). Each
   language needs its own regex, not a single template with
   placeholders.

### Parser dictionaries

Current Russian parsers hardcode text patterns: month names (`мая`,
`июня`), section headers (`СОКРОВИЩА ИЗ СЛОВА БОГА`), duration patterns
(`(N мин.)`), week range patterns.

To support multiple languages, the parser will accept a `language`
parameter and select the right dictionary:

    const PARSER_DICTIONARIES = {
      ru: {
        months: { январь: 1, января: 1, февраль: 2, ... },
        sectionMarkers: {
          treasures: 'СОКРОВИЩА ИЗ СЛОВА БОГА',
          ministry: 'ОТТАЧИВАЕМ НАВЫКИ СЛУЖЕНИЯ',
          christianLife: 'ХРИСТИАНСКАЯ ЖИЗНЬ',
        },
        durationPattern: /\(\s*(\d+)\s*мин/u,
        // MWB week range: "11-17 мая" (range first, lowercase month)
        mwbWeekRangePattern: /^(\d+)[-\u2013](\d+)\s+([а-я]+)$/u,
      },
      en: {
        months: { january: 1, february: 2, ... },
        sectionMarkers: {
          treasures: 'TREASURES FROM GOD\u2019S WORD',  // curly apostrophe
          ministry: 'APPLY YOURSELF TO THE FIELD MINISTRY',
          christianLife: 'LIVING AS CHRISTIANS',
        },
        durationPattern: /\(\s*(\d+)\s*min/iu,
        // MWB week range: "MAY 4-10" (uppercase month first, no year)
        mwbWeekRangePattern: /^([A-Z]+)\s+(\d+)[-\u2013](\d+)$/u,
        // WT week range: "MAY 4-10, 2026" (uppercase month, with year)
        wtWeekRangePattern: /^([A-Z]+)\s+(\d+)[-\u2013](\d+),\s+(\d{4})$/u,
      },
      de: {
        months: { januar: 1, februar: 2, ... },
        // ... TBD when we get an actual DE EPUB to inspect
      },
    };

### EPUB validation against congregation language

When a user uploads an EPUB, the system validates the detected language
matches the congregation's `meetingLanguage`:

    if (detectedLanguage !== congregation.meetingLanguage) {
      throw new BadRequestException(
        `File language (${detectedLanguage}) does not match your
         congregation's meeting language (${congregation.meetingLanguage}).
         Please download the correct edition from JW Library.`
      );
    }

The error message itself is translated (via Layer A) so the user sees
it in their UI language.

### Testing strategy

Each parser's Layer 1 unit tests (currently 36 for MWB, 24 for WT) must
be replicated for EN and DE:

- `mwb-parser.spec.ts` (existing, Russian)
- `mwb-parser-en.spec.ts` (new)
- `mwb-parser-de.spec.ts` (new)

Plus Layer 2 integration tests with HTML fixtures per language. Total
parser test count after i18n: ~180 tests (current 61 × 3 languages).

## Layer C: Locale-aware Formatting

Use the standard `Intl` API — built into JavaScript, no dependencies.

### Date formatting

    const formatter = new Intl.DateTimeFormat(user.uiLanguage, {
      dateStyle: 'long',
    });
    formatter.format(new Date('2026-05-13'));
    // ru: "13 мая 2026 г."
    // en: "May 13, 2026"
    // de: "13. Mai 2026"

Helper hook: `useDateFormat()` returns a memoized formatter for the
user's current locale.

### Number formatting

Pioneer hours, Bible study counts:

    new Intl.NumberFormat(user.uiLanguage).format(1234.5);
    // ru: "1 234,5"
    // en: "1,234.5"
    // de: "1.234,5"

### Plural rules

For strings like "X reports submitted":

    new Intl.PluralRules('ru').select(1);   // 'one'
    new Intl.PluralRules('ru').select(5);   // 'many'

STR dictionaries support plural variants:

    const STR = {
      ru: {
        reportsSubmitted: {
          one: '{count} отчёт сдан',
          few: '{count} отчёта сдано',
          many: '{count} отчётов сдано',
        },
      },
      en: {
        reportsSubmitted: {
          one: '{count} report submitted',
          other: '{count} reports submitted',
        },
      },
    };

The `useTranslations` hook handles plural lookup automatically based
on the count value.

## Congregation Language vs User UI Language

These are independent fields:

| Field | Owner | Purpose |
|-------|-------|---------|
| `Congregation.meetingLanguage` | Set at bootstrap, changed by admin | Language of meetings, EPUB content, public talks |
| `User.uiLanguage` | Each user, changeable in Profile | Language of menus, buttons, errors |

### Bootstrap flow

When a new congregation is created via `POST /auth/bootstrap`, the form
collects:

- `congregationName`
- `country`
- `meetingLanguage` (RU/EN/DE for MVP)
- `timezone`

The first admin user's `uiLanguage` defaults to `meetingLanguage`. They
can change it later.

### Common scenario: multilingual congregation

The Ahlen-Russisch congregation is Russian-speaking but located in Germany:

- `Congregation.meetingLanguage = 'ru'`
- Brother A: `uiLanguage = 'ru'` (native Russian speaker)
- Brother B: `uiLanguage = 'de'` (German native, learning Russian)
- Brother C: `uiLanguage = 'en'` (international visitor)

All three see the same meeting schedule with Russian content from the
EPUB. Their UI is in their preferred language.

## Schema Additions

### Congregation entity

    class Congregation {
      // ...existing fields...
      meetingLanguage: string  // ISO 639-1: 'ru' | 'en' | 'de'
    }

### User entity

    class User {
      // ...existing fields...
      uiLanguage: string  // ISO 639-1: 'ru' | 'en' | 'de'
                          // defaults to congregation.meetingLanguage at creation
    }

### Schedule weeks (audit)

Recording source language on imported records is cheap and useful for
audit and for tracking format variations across languages:

    class MwbWeek {
      // ...existing fields...
      sourceLanguage: string  // detected from EPUB filename at import
    }

## Implementation Phases

| Phase | Layer | Scope | Estimated effort |
|-------|-------|-------|------------------|
| **1** | A | `useTranslations` hook + STR pattern across existing screens. Profile language switcher. `User.uiLanguage` field. Two languages: RU + EN. | 3-4 hours |
| **2** | A | German (DE) added. STR dictionaries extended for all existing surfaces. | 2 hours |
| **3** | B | Parser refactor: extract Russian-specific constants into `PARSER_DICTIONARIES.ru`. Single-language parser still works. | 1-2 hours |
| **4** | B | English EPUB support: dictionaries, parser tests, EPUB validation at upload. | 2-3 hours |
| **5** | B | German EPUB support. Parser tests for DE. | 2 hours |
| **6** | C | Locale formatters integrated. Plural rules across all relevant STR strings. | 1-2 hours |

Each phase is independently shippable. Total: ~12-15 hours across 6 sessions.

## Open Questions

- **Q-OQ1.** Should congregations be allowed to change `meetingLanguage`
  after bootstrap? If yes, what happens to historical EPUB imports in
  the old language?
- **Q-OQ2.** RTL languages (Arabic, Hebrew) — out of scope for MVP,
  but should not be architecturally precluded.
- **Q-OQ3.** Translation maintenance: how do we ensure all three STR
  dictionaries stay in sync as new strings are added? Suggested: a CI
  check that every key in `ru` also exists in `en` and `de`.
- **Q-OQ4.** EPUB format variations: do EN and DE editions follow the
  exact same XHTML structure as Russian? Partially confirmed for EN
  via empirical inspection (May 2026). DE still TBD until we inspect
  a real `mwb_X_*.epub`.
- **Q-OQ5.** Per-congregation custom translations — out of scope; the
  system uses official JW terminology only.

## Glossary

| Term | Meaning |
|------|---------|
| Layer A | UI translation (client-side strings) |
| Layer B | EPUB parser language support (server-side) |
| Layer C | Locale-aware formatting (dates, numbers, plurals) |
| ISO 639-1 | Two-letter language code (`ru`, `en`, `de`, `fr`, ...) |
| `meetingLanguage` | Congregation's primary language for meetings and EPUB content |
| `uiLanguage` | Individual user's preference for menu/button language |
| JW language code | Single-letter code in EPUB filenames (U=Russian, E=English, X=German) |
| STR dictionary | Per-component object mapping keys to language-specific strings |
| Source-language content | Content from JW publications, kept in original language, never translated by our system |

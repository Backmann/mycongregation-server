import type { SupportedLanguage } from '../common/i18n/supported-languages';
import { SUGGESTION_WORDS } from './suggestion-words';

/**
 * What a congregation may set for each suggested announcement — the
 * «Templates» screen (announcements R-05, R-09 step 4, 26 November 2026):
 * whether it is offered at all, its own words, and how many weeks ahead.
 *
 * The words are kept with placeholders — {when}, {from}… — and filled in by
 * the rules with the dates and hours of the moment. Tokens are stored in this
 * one spelling whatever the language; the app shows them in the reader's own
 * words. A token the template does not know is refused on saving, so a typo
 * never reaches a chairman as «{dtae}».
 */
export const TEMPLATE_KEYS = [
  'general_cleaning',
  'co_visit.ahead',
  'co_visit.next',
  'memorial.ahead',
  'memorial.next',
  'convention.ahead',
  'convention.next',
  'field_service',
  'accounts_month',
  'accounts_audit',
  'assembly_screens',
  'campaign_part',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** The placeholders each template's words may use. Empty: no words of its own. */
export const TEMPLATE_TOKENS: Record<TemplateKey, readonly string[]> = {
  general_cleaning: ['when'],
  'co_visit.ahead': ['from', 'to', 'midweek'],
  'co_visit.next': ['from', 'to', 'midweek'],
  'memorial.ahead': ['when'],
  'memorial.next': ['when'],
  'convention.ahead': ['name', 'dates'],
  'convention.next': ['name', 'dates'],
  // Its words are the changed meetings themselves, line by line.
  field_service: [],
  accounts_month: ['month', 'report'],
  accounts_audit: ['months'],
  assembly_screens: ['program'],
  // A task, not an announcement: only on or off.
  campaign_part: [],
};

/** The templates offered weeks ahead, and the app's own number of weeks. */
export const TEMPLATE_WEEKS: Partial<Record<TemplateKey, number>> = {
  'co_visit.ahead': 4,
  'memorial.ahead': 5,
  'convention.ahead': 10,
};
export const WEEKS_MIN = 1;
export const WEEKS_MAX = 16;
export const WORDS_MAX = 2000;

export interface TemplateSetting {
  enabled: boolean;
  /** Null: the app's own words. */
  words: string | null;
  /** Null: the app's own number of weeks. */
  weeksAhead: number | null;
}

export type Templates = ReadonlyMap<TemplateKey, TemplateSetting>;

export const NO_TEMPLATES: Templates = new Map();

export function isTemplateKey(k: string): k is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(k);
}

/** Every «{token}» in the words. */
export function tokensIn(words: string): string[] {
  return [...words.matchAll(/\{([^{}\s]*)\}/g)].map((m) => m[1]);
}

/** The tokens the words use that this template does not know. */
export function unknownTokens(key: TemplateKey, words: string): string[] {
  const known = new Set(TEMPLATE_TOKENS[key]);
  return [...new Set(tokensIn(words))].filter((t) => !known.has(t));
}

/**
 * The words with the moment's values. A value the moment does not have — no
 * midweek meeting in a visit week, no programme link — becomes nothing, and
 * the spaces and stray punctuation around it are tidied.
 */
export function fill(
  words: string,
  values: Record<string, string | null | undefined>,
): string {
  return (
    words
      .replace(/\{([^{}\s]*)\}/g, (_, t: string) => values[t] ?? '')
      // A dash or colon left before the end of a sentence: «будни — .»
      .replace(/[ \t]*[—–:][ \t]*([.,;]|$)/gm, '$1')
      .replace(/[ \t]+([.,;:])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^[ \t—–-]+|[ \t—–-]+$/gm, '')
      .trim()
  );
}

/** The app's own words for a template, with its placeholders in place. */
export function defaultWords(
  key: TemplateKey,
  lang: SupportedLanguage,
): string | null {
  const w = SUGGESTION_WORDS[lang];
  switch (key) {
    case 'general_cleaning':
      return w.generalCleaning({ when: '{when}' });
    case 'co_visit.ahead':
      return w.coVisitAhead({
        from: '{from}',
        to: '{to}',
        midweek: '{midweek}',
      });
    case 'co_visit.next':
      return w.coVisitNext({
        from: '{from}',
        to: '{to}',
        midweek: '{midweek}',
      });
    case 'memorial.ahead':
      return w.memorialAhead({ when: '{when}' });
    case 'memorial.next':
      return w.memorialNext({ when: '{when}' });
    case 'convention.ahead':
      return w.conventionAhead({ name: '{name}', dates: '{dates}' });
    case 'convention.next':
      // The default lowers the name inside the sentence; the token keeps it.
      return w
        .conventionNext({ name: '{name}', dates: '{dates}' })
        .replace('{name}'.toLowerCase(), '{name}');
    case 'accounts_month':
      return w.accountsMonth({ month: '{month}', report: '{report}' });
    case 'accounts_audit':
      return w.accountsAudit({ months: '{months}' });
    case 'assembly_screens':
      return w.assemblyScreens({ programUrl: '{program}' });
    default:
      return null;
  }
}

/** Whether the congregation has it on (on unless turned off). */
export const isOn = (t: Templates, key: TemplateKey) =>
  t.get(key)?.enabled !== false;

export const weeksOf = (t: Templates, key: TemplateKey) =>
  t.get(key)?.weeksAhead ?? TEMPLATE_WEEKS[key] ?? 0;

/** The congregation's words if it has its own, else the app's. */
export function say(
  t: Templates,
  key: TemplateKey,
  own: () => string,
  values: Record<string, string | null | undefined>,
): string {
  const words = t.get(key)?.words;
  return words ? fill(words, values) : own();
}

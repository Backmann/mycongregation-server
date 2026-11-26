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
/** One week ahead is the week before — the «next» suggestion; two is the least that differs. */
export const WEEKS_MIN = 2;
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
  // Anything in braces on one line — «{ when }» included, so a typo is
  // refused rather than read aloud.
  return [...words.matchAll(/\{([^{}\n]*)\}/g)].map((m) => m[1]);
}

/** The tokens the words use that this template does not know. */
export function unknownTokens(key: TemplateKey, words: string): string[] {
  const known = new Set(TEMPLATE_TOKENS[key]);
  return [...new Set(tokensIn(words))].filter((t) => !known.has(t));
}

/**
 * A brace that is not part of a placeholder — «{{when}}», a «{» never
 * closed, a line break inside — would reach the chairman as written.
 */
export function strayBraces(words: string): boolean {
  return /[{}]/.test(words.replace(/\{([^{}\n]*)\}/g, ''));
}

/**
 * Control characters other than a line break or a tab: the database refuses
 * a NUL (a 500), and none of them is meant to be read aloud.
 */
export function hasControlChars(words: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(words);
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
  // Only what an EMPTY placeholder leaves behind is tidied; the rest of the
  // words stay exactly as written — colons, dashes, lists, links (found by
  // the independent check: a global tidy cut «Внимание:» and list dashes).
  const GAP = '\u0000';
  let s = words.replace(/\{([^{}\n]*)\}/g, (_, t: string) => {
    const v = values[t];
    return v == null || v === '' ? GAP : v;
  });
  if (!s.includes(GAP)) return s.trim();
  const kept: string[] = [];
  for (const line of s.split('\n')) {
    if (!line.includes(GAP)) {
      kept.push(line);
      continue;
    }
    const rest = line.replace(new RegExp(GAP, 'g'), '').trim();
    // Nothing but a label or a list mark left — «Программа:», «-» — the line
    // goes whole; a label standing alone on the line above it goes too.
    if (/^[\s\-–—•*:.,;()]*$/.test(rest) || /[:—–]$/.test(rest)) {
      if (!rest.replace(/[\s\-–—•*]/g, '') && /:\s*$/.test(kept.at(-1) ?? ''))
        kept.pop();
      continue;
    }
    let out = line
      // «встреча ({x})» → «встреча»
      .replace(new RegExp(`[ \\t]*\\([ \\t]*${GAP}[ \\t]*\\)`, 'g'), '')
      // «будни — {x}.» → «будни.»; «в {x}: приходите» → «в: приходите»
      .replace(
        new RegExp(`[ \\t]*[—–:]?[ \\t]*${GAP}[ \\t]*(?=([.,;:!?]|$))`, 'g'),
        '',
      )
      // «{x} — встреча» → «Встреча»
      .replace(new RegExp(`^[ \\t]*${GAP}[ \\t]*[—–:]?[ \\t]*`), '')
      .replace(new RegExp(`[ \\t]*${GAP}[ \\t]*`, 'g'), ' ');
    if (/^\s*$/.test(out)) continue;
    if (line.trimStart().startsWith(GAP))
      out = out.charAt(0).toUpperCase() + out.slice(1);
    kept.push(out);
  }
  return kept.join('\n').trim();
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
      return w.conventionNext({ name: '{name}', dates: '{dates}' });
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
  if (!words) return own();
  // Own words made only of what is missing this time (say a link not given
  // yet) would leave an empty announcement: the app's words stand in.
  const text = fill(words, values);
  return text.trim() ? text : own();
}

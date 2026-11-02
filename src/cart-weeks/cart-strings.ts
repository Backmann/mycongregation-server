import { SupportedLanguage } from '../common/i18n/supported-languages';
import { shortDay } from '../assignment-reminders/digest';
import { formatWeekRange } from '../common/i18n/push-strings';

/**
 * What the public-witnessing notifications say (rewritten 2 November 2026).
 *
 * Every message is about the PERSON who reads it — «вы стоите во вторник
 * у вокзала, вместе с …» — not «расписание опубликовано», which sent him to
 * look for himself among forty cells. And the place is named by the kind of
 * equipment it has: «Тележки» was said of every stand.
 */

/** One shift as a line: «Вт 3 ноября, 09:00–11:00 · Bahnhof (стенд)». */
export interface ShiftLine {
  date: string;
  startTime: string;
  endTime: string;
  place: string;
  kind: string;
  /** The others in the shift, by name; empty when he stands alone so far. */
  with?: string[];
}

const KIND: Record<SupportedLanguage, Record<string, string>> = {
  ru: { cart: 'тележка', stand: 'стенд', kiosk: 'стойка', table: 'стол' },
  en: { cart: 'cart', stand: 'stand', kiosk: 'kiosk', table: 'table' },
  de: { cart: 'Trolley', stand: 'Ständer', kiosk: 'Kiosk', table: 'Tisch' },
};

const WITH: Record<SupportedLanguage, string> = {
  ru: 'вместе',
  en: 'with',
  de: 'mit',
};

const hhmm = (t: string) => String(t).slice(0, 5);

export function shiftLine(s: ShiftLine, lang: SupportedLanguage): string {
  const day = shortDay(String(s.date).slice(0, 10), lang);
  const kind = KIND[lang][s.kind] ?? '';
  const place = s.place ? `${s.place}${kind ? ` (${kind})` : ''}` : kind;
  const people =
    s.with && s.with.length > 0
      ? ` · ${WITH[lang]}${lang === 'ru' ? ':' : ''} ${s.with.join(', ')}`
      : '';
  return `${day}, ${hhmm(s.startTime)}–${hhmm(s.endTime)} · ${place}${people}`;
}

/** Several shifts in one message: three named, the rest counted. */
export function shiftLines(
  lines: ShiftLine[],
  lang: SupportedLanguage,
): string {
  const shown = lines.slice(0, 3).map((l) => shiftLine(l, lang));
  const more = lines.length - shown.length;
  if (more > 0) shown.push(MORE[lang](more));
  return shown.join('\n');
}

const MORE: Record<SupportedLanguage, (n: number) => string> = {
  ru: (n) => `и ещё ${n}`,
  en: (n) => `and ${n} more`,
  de: (n) => `und ${n} weitere`,
};

export const CART_STR: Record<
  SupportedLanguage,
  {
    section: string;
    openTitle: string;
    openBody: (weekStart: string) => string;
    publishedTitle: (n: number) => string;
    assignedTitle: string;
    unassignedTitle: string;
    requestTitle: string;
    requestBody: (line: string, who: string) => string;
    /** To whoever arranges the shifts: the place is free again. */
    cancelTitle: string;
    cancelBody: (line: string, who: string) => string;
    /** To the others in that shift: they are one fewer. */
    partnerCancelTitle: string;
    partnerCancelBody: (line: string, who: string) => string;
    shiftCancelledTitle: (n: number) => string;
    reason: (r: string) => string;
    shiftRestoredTitle: (n: number) => string;
  }
> = {
  ru: {
    section: 'Служение в общественных местах',
    openTitle: 'Запись на служение в общественных местах',
    openBody: (w) =>
      `Открыта запись на ${formatWeekRange(w, 'ru')}. Отметьте смены, в которые можете.`,
    publishedTitle: (n) => (n === 1 ? 'Ваша смена' : 'Ваши смены'),
    assignedTitle: 'Вас поставили на смену',
    unassignedTitle: 'Вас сняли со смены',
    requestTitle: 'Новая заявка на свободное место',
    requestBody: (line, who) => `${who}: ${line}`,
    cancelTitle: 'Отмена участия',
    cancelBody: (line, who) =>
      `${who} не сможет — ${line}. Место снова свободно.`,
    partnerCancelTitle: 'Напарник не сможет',
    partnerCancelBody: (line, who) => `${who} не сможет — ${line}.`,
    shiftCancelledTitle: (n) => (n === 1 ? 'Смена отменена' : 'Смены отменены'),
    reason: (r) => `Причина: ${r}`,
    shiftRestoredTitle: (n) =>
      n === 1 ? 'Смена снова в силе' : 'Смены снова в силе',
  },
  en: {
    section: 'Public witnessing',
    openTitle: 'Public witnessing: sign-up open',
    openBody: (w) =>
      `Sign-up is open for ${formatWeekRange(w, 'en')}. Mark the shifts you can take.`,
    publishedTitle: (n) => (n === 1 ? 'Your shift' : 'Your shifts'),
    assignedTitle: 'You were put on a shift',
    unassignedTitle: 'You were taken off a shift',
    requestTitle: 'A request for a free place',
    requestBody: (line, who) => `${who}: ${line}`,
    cancelTitle: 'Cannot come',
    cancelBody: (line, who) =>
      `${who} cannot come — ${line}. The place is free again.`,
    partnerCancelTitle: 'Your partner cannot come',
    partnerCancelBody: (line, who) => `${who} cannot come — ${line}.`,
    shiftCancelledTitle: (n) =>
      n === 1 ? 'Shift cancelled' : 'Shifts cancelled',
    reason: (r) => `Reason: ${r}`,
    shiftRestoredTitle: (n) =>
      n === 1 ? 'Shift is on again' : 'Shifts are on again',
  },
  // «Sie», as the app speaks German (decision of 28 September 2026).
  de: {
    section: 'Öffentliches Zeugnisgeben',
    openTitle: 'Öffentliches Zeugnisgeben: Eintragung offen',
    openBody: (w) =>
      `Die Eintragung für ${formatWeekRange(w, 'de')} ist offen. Markieren Sie die Schichten, die Sie übernehmen können.`,
    publishedTitle: (n) => (n === 1 ? 'Ihre Schicht' : 'Ihre Schichten'),
    assignedTitle: 'Sie wurden für eine Schicht eingeteilt',
    unassignedTitle: 'Sie wurden aus einer Schicht genommen',
    requestTitle: 'Anfrage für einen freien Platz',
    requestBody: (line, who) => `${who}: ${line}`,
    cancelTitle: 'Absage',
    cancelBody: (line, who) =>
      `${who} kann nicht — ${line}. Der Platz ist wieder frei.`,
    partnerCancelTitle: 'Ihr Partner kann nicht',
    partnerCancelBody: (line, who) => `${who} kann nicht — ${line}.`,
    shiftCancelledTitle: (n) =>
      n === 1 ? 'Schicht abgesagt' : 'Schichten abgesagt',
    reason: (r) => `Grund: ${r}`,
    shiftRestoredTitle: (n) =>
      n === 1 ? 'Schicht findet wieder statt' : 'Schichten finden wieder statt',
  },
};

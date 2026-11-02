import { SupportedLanguage } from '../common/i18n/supported-languages';
import { shortDay } from '../assignment-reminders/digest';
import { formatWeekRange } from '../common/i18n/push-strings';

/**
 * What the stand's notifications say (rewritten 2 November 2026).
 *
 * Every message is about the PERSON who reads it — «вы стоите в пятницу
 * 10:00–12:00 в Hamm, вместе: …» — not «расписание опубликовано», which sent
 * him to look for himself in a table. The place is named by the kind of
 * equipment it has; «Тележки» was said of every stand.
 */

/** One person's time at the stand on one day, as a line of a message. */
export interface ShiftLine {
  date: string;
  startTime: string;
  endTime: string;
  place: string;
  kind: string;
  /** Who stands at the same time, each with his own hours. */
  with?: { name: string; startTime: string; endTime: string }[];
}

const KIND: Record<SupportedLanguage, Record<string, string>> = {
  ru: { cart: 'тележка', stand: 'стенд', kiosk: 'стойка', table: 'стол' },
  en: { cart: 'cart', stand: 'stand', kiosk: 'kiosk', table: 'table' },
  de: { cart: 'Trolley', stand: 'Ständer', kiosk: 'Kiosk', table: 'Tisch' },
};

const WITH: Record<SupportedLanguage, string> = {
  ru: 'вместе:',
  en: 'with',
  de: 'mit',
};

const hhmm = (t: string) => String(t).slice(0, 5);

/** «Хоффман Феликс (10:00–11:30)» — the hours only when they are not his. */
function partner(
  p: { name: string; startTime: string; endTime: string },
  mine: { startTime: string; endTime: string },
): string {
  const same =
    hhmm(p.startTime) === hhmm(mine.startTime) &&
    hhmm(p.endTime) === hhmm(mine.endTime);
  return same ? p.name : `${p.name} (${hhmm(p.startTime)}–${hhmm(p.endTime)})`;
}

export function shiftLine(s: ShiftLine, lang: SupportedLanguage): string {
  const day = shortDay(String(s.date).slice(0, 10), lang);
  const kind = KIND[lang][s.kind] ?? '';
  const place = s.place ? `${s.place}${kind ? ` (${kind})` : ''}` : kind;
  const people =
    s.with && s.with.length > 0
      ? ` · ${WITH[lang]} ${s.with.map((p) => partner(p, s)).join(', ')}`
      : '';
  return `${day}, ${hhmm(s.startTime)}–${hhmm(s.endTime)} · ${place}${people}`;
}

/** Several lines in one message: three named, the rest counted. */
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

export interface CartWords {
  openTitle: string;
  openBody: (weekStart: string, until: string | null) => string;
  publishedTitle: (n: number) => string;
  assignedTitle: string;
  changedTitle: string;
  unassignedTitle: string;
  crewTitle: string;
  requestTitle: string;
  requestBody: (line: string, who: string) => string;
  /** To whoever arranges: the place is free again. */
  cancelTitle: string;
  cancelBody: (line: string, who: string) => string;
  /** To the others at that time: they are one fewer. */
  partnerCancelTitle: string;
  partnerCancelBody: (line: string, who: string) => string;
  /** To those who asked for that time and were not put on. */
  freeTitle: string;
  freeBody: (line: string) => string;
  offTitle: string;
  reason: (r: string) => string;
  onTitle: string;
  signupTitle: string;
  signupBody: (weekStart: string) => string;
  collectTitle: string;
  collectBody: (weekStart: string) => string;
  unpublishedTitle: string;
  unpublishedBody: (weekStart: string) => string;
  permitTitle: string;
  permitBody: (place: string, until: string) => string;
}

const dayMonth = (iso: string, lang: SupportedLanguage) =>
  shortDay(String(iso).slice(0, 10), lang);

export const CART_STR: Record<SupportedLanguage, CartWords> = {
  ru: {
    openTitle: 'Запись на служение в общественных местах',
    openBody: (w, u) =>
      `Открыта запись на ${formatWeekRange(w, 'ru')}${u ? ` — до ${dayMonth(u, 'ru')}` : ''}. Отметьте, когда можете.`,
    publishedTitle: (n) => (n === 1 ? 'Ваша смена' : 'Ваши смены'),
    assignedTitle: 'Вас поставили на смену',
    changedTitle: 'Ваша смена изменилась',
    unassignedTitle: 'Вас сняли со смены',
    crewTitle: 'Состав смены поменялся',
    requestTitle: 'Новая заявка на свободное время',
    requestBody: (line, who) => `${who}: ${line}`,
    cancelTitle: 'Отмена участия',
    cancelBody: (line, who) =>
      `${who} не сможет — ${line}. Место снова свободно.`,
    partnerCancelTitle: 'Напарник не сможет',
    partnerCancelBody: (line, who) => `${who} не сможет — ${line}.`,
    freeTitle: 'Освободилось место',
    freeBody: (line) =>
      `Вы просились: ${line}. Если ещё можете — запишитесь снова.`,
    offTitle: 'Служение отменено',
    reason: (r) => `Причина: ${r}`,
    onTitle: 'Служение снова в силе',
    signupTitle: 'Запись на служение в общественных местах',
    signupBody: (w) =>
      `Завтра заканчивается запись на ${formatWeekRange(w, 'ru')}. Если можете — отметьтесь.`,
    collectTitle: 'Запись закончилась',
    collectBody: (w) =>
      `Неделя ${formatWeekRange(w, 'ru')}: соберите составы и опубликуйте план.`,
    unpublishedTitle: 'План не опубликован',
    unpublishedBody: (w) =>
      `Неделя ${formatWeekRange(w, 'ru')} скоро начнётся, а план ещё не опубликован.`,
    permitTitle: 'Разрешение города заканчивается',
    permitBody: (p, u) => `${p}: разрешение действует до ${dayMonth(u, 'ru')}.`,
  },
  en: {
    openTitle: 'Public witnessing: sign-up open',
    openBody: (w, u) =>
      `Sign-up is open for ${formatWeekRange(w, 'en')}${u ? ` — until ${dayMonth(u, 'en')}` : ''}. Mark when you can.`,
    publishedTitle: (n) => (n === 1 ? 'Your shift' : 'Your shifts'),
    assignedTitle: 'You were put on a shift',
    changedTitle: 'Your shift has changed',
    unassignedTitle: 'You were taken off a shift',
    crewTitle: 'Your crew has changed',
    requestTitle: 'A request for free time',
    requestBody: (line, who) => `${who}: ${line}`,
    cancelTitle: 'Cannot come',
    cancelBody: (line, who) =>
      `${who} cannot come — ${line}. The place is free again.`,
    partnerCancelTitle: 'Your partner cannot come',
    partnerCancelBody: (line, who) => `${who} cannot come — ${line}.`,
    freeTitle: 'A place is free',
    freeBody: (line) =>
      `You asked for: ${line}. If you still can, sign up again.`,
    offTitle: 'Witnessing cancelled',
    reason: (r) => `Reason: ${r}`,
    onTitle: 'Witnessing is on again',
    signupTitle: 'Public witnessing: sign-up',
    signupBody: (w) =>
      `Sign-up for ${formatWeekRange(w, 'en')} closes tomorrow. If you can, mark your time.`,
    collectTitle: 'Sign-up has closed',
    collectBody: (w) =>
      `Week ${formatWeekRange(w, 'en')}: put the crews together and publish the plan.`,
    unpublishedTitle: 'Plan not published',
    unpublishedBody: (w) =>
      `Week ${formatWeekRange(w, 'en')} starts soon and its plan is not published.`,
    permitTitle: 'Town permit ending',
    permitBody: (p, u) => `${p}: the permit holds until ${dayMonth(u, 'en')}.`,
  },
  // «Sie», as the app speaks German (decision of 28 September 2026).
  de: {
    openTitle: 'Öffentliches Zeugnisgeben: Eintragung offen',
    openBody: (w, u) =>
      `Die Eintragung für ${formatWeekRange(w, 'de')} ist offen${u ? ` — bis ${dayMonth(u, 'de')}` : ''}. Markieren Sie, wann Sie können.`,
    publishedTitle: (n) => (n === 1 ? 'Ihre Schicht' : 'Ihre Schichten'),
    assignedTitle: 'Sie wurden eingeteilt',
    changedTitle: 'Ihre Schicht hat sich geändert',
    unassignedTitle: 'Sie wurden aus einer Schicht genommen',
    crewTitle: 'Ihre Schicht ist neu besetzt',
    requestTitle: 'Anfrage für freie Zeit',
    requestBody: (line, who) => `${who}: ${line}`,
    cancelTitle: 'Absage',
    cancelBody: (line, who) =>
      `${who} kann nicht — ${line}. Der Platz ist wieder frei.`,
    partnerCancelTitle: 'Ihr Partner kann nicht',
    partnerCancelBody: (line, who) => `${who} kann nicht — ${line}.`,
    freeTitle: 'Ein Platz ist frei',
    freeBody: (line) =>
      `Sie hatten angefragt: ${line}. Wenn Sie noch können, tragen Sie sich wieder ein.`,
    offTitle: 'Zeugnisgeben abgesagt',
    reason: (r) => `Grund: ${r}`,
    onTitle: 'Zeugnisgeben findet wieder statt',
    signupTitle: 'Öffentliches Zeugnisgeben: Eintragung',
    signupBody: (w) =>
      `Morgen endet die Eintragung für ${formatWeekRange(w, 'de')}. Wenn Sie können, tragen Sie sich ein.`,
    collectTitle: 'Eintragung beendet',
    collectBody: (w) =>
      `Woche ${formatWeekRange(w, 'de')}: Stellen Sie die Schichten zusammen und veröffentlichen Sie den Plan.`,
    unpublishedTitle: 'Plan nicht veröffentlicht',
    unpublishedBody: (w) =>
      `Die Woche ${formatWeekRange(w, 'de')} beginnt bald, der Plan ist noch nicht veröffentlicht.`,
    permitTitle: 'Genehmigung läuft ab',
    permitBody: (p, u) =>
      `${p}: die Genehmigung gilt bis ${dayMonth(u, 'de')}.`,
  },
};

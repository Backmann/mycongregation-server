import { SupportedLanguage } from '../common/i18n/supported-languages';
import {
  addDaysISO,
  isCongressEvent,
  isoDowOf,
  memorialTakesKind,
} from '../common/week-rules';

/**
 * What the congregation is told about an event, in each language.
 *
 * Pure — no database, no clock — so every wording can be read and tested in
 * one place. The notification says what happens and what it means for the
 * meetings; the details stay on the event's own page, one tap away.
 */
export type EventChange = 'created' | 'changed' | 'cancelled' | 'restored';

export interface EventForMessage {
  title: string;
  type: string | null;
  date: string;
  endDate: string | null;
  time: string | null;
  timeEnd: string | null;
  address: string | null;
  replacesMeeting: boolean;
  coFirstName?: string | null;
  coLastName?: string | null;
  coMidweekDow?: number | null;
}

export interface Message {
  title: string;
  body: string;
}

type Strings = {
  created: (t: string) => string;
  changed: (t: string) => string;
  cancelled: (t: string) => string;
  restored: (t: string) => string;
  tomorrow: (t: string) => string;
  now: string;
  startsAt: (time: string) => string;
  noMeetingsWeek: string;
  noMeetingsBack: string;
  midweekOn: (day: string) => string;
  midweekBack: string;
  noMeetingThatDay: string;
  memorialInsteadMidweek: string;
  memorialInsteadWeekend: string;
  wontHappen: (when: string) => string;
  visitTomorrow: (who: string) => string;
};

const STR: Record<SupportedLanguage, Strings> = {
  ru: {
    created: (t) => `Новое событие: ${t}`,
    changed: (t) => `Изменение: ${t}`,
    cancelled: (t) => `Отменено: ${t}`,
    restored: (t) => `Снова в силе: ${t}`,
    tomorrow: (t) => `Завтра — ${t}`,
    now: 'Теперь',
    startsAt: (time) => `начало в ${time}`,
    noMeetingsWeek: 'Встреч собрания на этой неделе не будет.',
    noMeetingsBack: 'Встречи собрания на этой неделе идут как обычно.',
    midweekOn: (day) => `Будняя встреча — ${day}.`,
    midweekBack: 'Программа недели вернулась к обычной.',
    noMeetingThatDay: 'Обычной встречи в этот день нет.',
    memorialInsteadMidweek: 'Вместо встречи в будний день.',
    memorialInsteadWeekend: 'Вместо встречи в выходной.',
    wontHappen: (when) => `${when} — события не будет.`,
    visitTomorrow: (who) =>
      who
        ? `Будняя встреча с районным старейшиной — ${who}.`
        : 'Будняя встреча с районным старейшиной.',
  },
  en: {
    created: (t) => `New event: ${t}`,
    changed: (t) => `Changed: ${t}`,
    cancelled: (t) => `Cancelled: ${t}`,
    restored: (t) => `On again: ${t}`,
    tomorrow: (t) => `Tomorrow — ${t}`,
    now: 'Now',
    startsAt: (time) => `starts at ${time}`,
    noMeetingsWeek: 'No congregation meetings this week.',
    noMeetingsBack: 'The congregation meetings this week are held as usual.',
    midweekOn: (day) => `Midweek meeting — ${day}.`,
    midweekBack: 'The week’s programme is back to normal.',
    noMeetingThatDay: 'No regular meeting that day.',
    memorialInsteadMidweek: 'In place of the midweek meeting.',
    memorialInsteadWeekend: 'In place of the weekend meeting.',
    wontHappen: (when) => `${when} — the event will not take place.`,
    visitTomorrow: (who) =>
      who
        ? `Midweek meeting with the circuit overseer — ${who}.`
        : 'Midweek meeting with the circuit overseer.',
  },
  de: {
    created: (t) => `Neues Ereignis: ${t}`,
    changed: (t) => `Geändert: ${t}`,
    cancelled: (t) => `Abgesagt: ${t}`,
    restored: (t) => `Wieder geplant: ${t}`,
    tomorrow: (t) => `Morgen — ${t}`,
    now: 'Jetzt',
    startsAt: (time) => `Beginn ${time}`,
    noMeetingsWeek: 'In dieser Woche finden keine Zusammenkünfte statt.',
    noMeetingsBack: 'Die Zusammenkünfte dieser Woche finden wie gewohnt statt.',
    midweekOn: (day) => `Zusammenkunft unter der Woche — ${day}.`,
    midweekBack: 'Das Programm der Woche ist wieder wie gewohnt.',
    noMeetingThatDay: 'An diesem Tag keine gewöhnliche Zusammenkunft.',
    memorialInsteadMidweek: 'Anstelle der Zusammenkunft unter der Woche.',
    memorialInsteadWeekend: 'Anstelle der Zusammenkunft am Wochenende.',
    wontHappen: (when) => `${when} — das Ereignis findet nicht statt.`,
    visitTomorrow: (who) =>
      who
        ? `Zusammenkunft unter der Woche mit dem Kreisaufseher — ${who}.`
        : 'Zusammenkunft unter der Woche mit dem Kreisaufseher.',
  },
};

const VISIT = 'circuit_overseer_visit';

function fmt(
  dateISO: string,
  lang: SupportedLanguage,
  opts: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(lang, opts).format(
      new Date(`${dateISO}T12:00:00Z`),
    );
  } catch {
    return dateISO;
  }
}

/** «воскресенье, 8 ноября» / «16 июля – 18 июля». */
export function whenOf(e: EventForMessage, lang: SupportedLanguage): string {
  if (e.endDate && e.endDate !== e.date) {
    const o: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    };
    return `${fmt(e.date, lang, o)} – ${fmt(e.endDate, lang, o)}`;
  }
  return fmt(e.date, lang, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/** The day the midweek meeting is held during a circuit visit. */
export function visitMidweekDay(e: EventForMessage): string {
  const monday = addDaysISO(e.date, 1 - isoDowOf(e.date));
  return addDaysISO(monday, (e.coMidweekDow ?? 2) - 1);
}

/**
 * The day the evening-before reminder is about: a visit's is the moved
 * midweek meeting — that is the day people have to remember; everything
 * else, its first day.
 */
export function reminderDayOf(e: EventForMessage): string {
  return e.type === VISIT ? visitMidweekDay(e) : e.date;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Time and place in one short clause, or nothing. */
function timePlace(e: EventForMessage, s: Strings): string {
  // «начало в 09:40», but a range speaks for itself: «09:40–16:00».
  const time = e.time
    ? e.timeEnd
      ? `${e.time}–${e.timeEnd}`
      : s.startsAt(e.time)
    : null;
  return [time, e.address].filter(Boolean).join(' · ');
}

/** What the event means for the congregation's own meetings. */
function effectOf(
  e: EventForMessage,
  s: Strings,
  lang: SupportedLanguage,
): string | null {
  if (isCongressEvent({ type: e.type, date: e.date })) return s.noMeetingsWeek;
  if (e.type === VISIT) {
    return s.midweekOn(
      fmt(visitMidweekDay(e), lang, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      }),
    );
  }
  if (e.type === 'memorial') {
    return memorialTakesKind(e.date) === 'weekend'
      ? s.memorialInsteadWeekend
      : s.memorialInsteadMidweek;
  }
  if (e.replacesMeeting) return s.noMeetingThatDay;
  return null;
}

function sentence(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function eventMessage(
  change: EventChange,
  e: EventForMessage,
  lang: SupportedLanguage,
): Message {
  const s = STR[lang];
  const when = capitalize(whenOf(e, lang));
  const tp = timePlace(e, s);
  const head = tp ? `${when} · ${tp}.` : `${when}.`;
  switch (change) {
    case 'created':
      return {
        title: s.created(e.title),
        body: sentence([head, effectOf(e, s, lang)]),
      };
    case 'restored':
      return {
        title: s.restored(e.title),
        body: sentence([head, effectOf(e, s, lang)]),
      };
    case 'changed':
      return {
        title: s.changed(e.title),
        body: sentence([`${s.now}: ${head}`, effectOf(e, s, lang)]),
      };
    case 'cancelled': {
      const back = isCongressEvent({ type: e.type, date: e.date })
        ? s.noMeetingsBack
        : e.type === VISIT
          ? s.midweekBack
          : null;
      return {
        title: s.cancelled(e.title),
        body: sentence([s.wontHappen(when), back]),
      };
    }
  }
}

/** «Завтра — …», sent the evening before. */
export function reminderMessage(
  e: EventForMessage,
  lang: SupportedLanguage,
): Message {
  const s = STR[lang];
  if (e.type === VISIT) {
    const who = [e.coFirstName, e.coLastName].filter(Boolean).join(' ');
    return { title: s.tomorrow(e.title), body: s.visitTomorrow(who) };
  }
  const tp = timePlace(e, s);
  return {
    title: s.tomorrow(e.title),
    body: sentence([tp ? `${capitalize(tp)}.` : null, effectOf(e, s, lang)]),
  };
}

/**
 * What a change must touch for the congregation to be told again: the days,
 * the hours, the place, the kind, whether the meeting goes — not a note or a
 * link. Also the key that makes the same change said once.
 */
export function signatureOf(e: EventForMessage): string {
  return [
    e.type ?? '',
    e.date,
    e.endDate ?? '',
    e.time ?? '',
    e.timeEnd ?? '',
    e.address ?? '',
    e.replacesMeeting ? '1' : '0',
    e.coMidweekDow ?? '',
  ].join('|');
}

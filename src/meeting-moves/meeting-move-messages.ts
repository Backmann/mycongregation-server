import { SupportedLanguage } from '../common/i18n/supported-languages';
import type { MeetingKind } from '../common/week-rules';
import { minutesOfDayIn, todayIn } from '../common/congregation-clock';
import { daysBetween } from '../assignment-reminders/digest';

/**
 * The words of a moved meeting (4 November 2026), in the reader's language —
 * as agreed on the mockup: one notice for the congregation, and for each
 * person with a part or a duty at that meeting a notice of his own INSTEAD of
 * it, naming what he has there.
 */
export interface MoveForMessage {
  kind: MeetingKind;
  from: { date: string; time: string | null };
  to: { date: string; time: string | null; address: string | null };
  /** Back to the usual day, hour and place. */
  back: boolean;
}

export interface Message {
  title: string;
  body: string;
}

type Strings = {
  title: string;
  backTitle: string;
  mineTitle: string;
  mineBackTitle: string;
  meeting: Record<MeetingKind, string>;
  hall: string;
  at: (time: string) => string;
  instead: (when: string) => string;
  insteadHour: (time: string) => string;
  asUsual: string;
  yours: (what: string) => string;
};

const STR: Record<SupportedLanguage, Strings> = {
  ru: {
    title: 'Встреча переносится',
    backTitle: 'Встреча — снова как обычно',
    mineTitle: 'Ваше назначение переносится',
    mineBackTitle: 'Ваше назначение — снова как обычно',
    meeting: {
      midweek: 'Будняя встреча на этой неделе',
      weekend: 'Выходная встреча на этой неделе',
    },
    hall: 'Зал Царства',
    at: (t) => `в ${t}`,
    instead: (w) => `Вместо: ${w}.`,
    insteadHour: (t) => `Вместо ${t}.`,
    asUsual: 'как обычно',
    yours: (w) => `У вас: ${w}.`,
  },
  en: {
    title: 'Meeting moved',
    backTitle: 'Meeting back to usual',
    mineTitle: 'Your assignment has moved',
    mineBackTitle: 'Your assignment is back to usual',
    meeting: {
      midweek: 'This week’s midweek meeting',
      weekend: 'This week’s weekend meeting',
    },
    hall: 'Kingdom Hall',
    at: (t) => `at ${t}`,
    instead: (w) => `Instead of ${w}.`,
    insteadHour: (t) => `Instead of ${t}.`,
    asUsual: 'as usual',
    yours: (w) => `Yours: ${w}.`,
  },
  de: {
    title: 'Zusammenkunft verlegt',
    backTitle: 'Zusammenkunft wieder wie gewohnt',
    mineTitle: 'Ihre Aufgabe ist verlegt',
    mineBackTitle: 'Ihre Aufgabe wieder wie gewohnt',
    meeting: {
      midweek: 'Die Zusammenkunft unter der Woche',
      weekend: 'Die Zusammenkunft am Wochenende',
    },
    hall: 'Königreichssaal',
    at: (t) => `um ${t} Uhr`,
    instead: (w) => `Statt ${w}.`,
    insteadHour: (t) => `Statt ${t} Uhr.`,
    asUsual: 'wie gewohnt',
    yours: (w) => `Ihre Aufgabe: ${w}.`,
  },
};

/** «четверг, 12 ноября» — the weekday carries half the meaning. */
export function dayOf(dateISO: string, lang: SupportedLanguage): string {
  try {
    const locale = lang === 'en' ? 'en-GB' : lang;
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${dateISO}T12:00:00Z`));
  } catch {
    return dateISO;
  }
}

function when(
  x: { date: string; time: string | null },
  s: Strings,
  lang: SupportedLanguage,
): string {
  return [dayOf(x.date, lang), x.time ? s.at(x.time) : null]
    .filter(Boolean)
    .join(', ');
}

/** The sentence everybody reads. */
function body(m: MoveForMessage, lang: SupportedLanguage): string {
  const s = STR[lang];
  const place = m.to.address?.trim() || s.hall;
  const head = `${s.meeting[m.kind]} — ${m.back ? `${s.asUsual}: ` : ''}${when(
    m.to,
    s,
    lang,
  )}, ${place}.`;
  if (m.back) return head;
  const sameDay = m.from.date === m.to.date;
  const was = sameDay
    ? m.from.time && m.from.time !== m.to.time
      ? s.insteadHour(m.from.time)
      : null
    : s.instead(when(m.from, s, lang));
  return [head, was].filter(Boolean).join(' ');
}

export function moveMessage(
  m: MoveForMessage,
  lang: SupportedLanguage,
): Message {
  const s = STR[lang];
  return { title: m.back ? s.backTitle : s.title, body: body(m, lang) };
}

/** For a person with a part or a duty there: what he has, named. */
export function moveMessageForAssignee(
  m: MoveForMessage,
  mine: string[],
  lang: SupportedLanguage,
): Message {
  const s = STR[lang];
  const what = mine.length > 0 ? ` ${s.yours(mine.join(', '))}` : '';
  return {
    title: m.back ? s.mineBackTitle : s.mineTitle,
    body: `${body(m, lang)}${what}`,
  };
}

/** Minutes from now to a meeting's start, by the congregation's clock. */
export function minutesUntil(
  at: { date: string; time: string | null },
  now: Date,
  tz: string,
): number {
  const today = todayIn(now, tz);
  const [h, m] = (at.time ?? '00:00').split(':').map(Number);
  return (
    daysBetween(today, at.date) * 1440 + h * 60 + m - minutesOfDayIn(now, tz)
  );
}

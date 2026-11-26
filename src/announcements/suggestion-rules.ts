import { createHash } from 'crypto';
import type { SupportedLanguage } from '../common/i18n/supported-languages';
import type { MeetingKind, WeekRules } from '../common/week-rules';
import { addDaysISO, visitMidweekDowOf } from '../common/week-rules';
import { mondayOf } from '../common/week';
import { SUGGESTION_WORDS, type SuggestionWords } from './suggestion-words';

/**
 * What the app offers the announcement writers, and for which meeting
 * (announcements R-04, R-06, R-08, R-09).
 *
 * A suggestion is computed, never stored: it comes from the events, the
 * meetings for field service and the elders' tasks as they stand now. Only
 * two things are stored — that it was taken (the announcement keeps its
 * `sourceKey`) and that a writer said «not needed» (a dismissal).
 *
 * Each suggestion has ONE target week, chosen by the week rules, so the
 * meetings it may go to are the meetings actually held that week: a
 * convention week has none, a circuit-overseer visit moves the midweek
 * meeting, the Memorial takes one (R-06). It also carries `facts` — a short
 * fingerprint of the dates and hours its words were made from. An
 * announcement taken from it keeps that fingerprint; when the event changes,
 * the fingerprint no longer matches and the writer is told the text is stale.
 *
 * Nothing here reads a clock or a database: the service hands everything in,
 * and the tests can say exactly which day it is.
 */

export type SuggestionTopic =
  | 'general_cleaning'
  | 'co_visit'
  | 'memorial'
  | 'convention'
  | 'field_service'
  | 'accounts_month'
  | 'accounts_audit';

/** «ahead» — weeks in advance; «next» — the last week before. */
export type SuggestionStage = 'ahead' | 'next' | 'once';

export type SuggestionGap = 'time' | 'report';

export interface Suggestion {
  /** Stable while the thing it comes from exists: «memorial:ahead:<id>». */
  key: string;
  topic: SuggestionTopic;
  stage: SuggestionStage;
  /** Monday of the week whose meetings it is meant for. */
  targetWeek: string;
  /** The meetings of that week it may go to, in order. */
  meetings: { kind: MeetingKind; date: string }[];
  /** The ones the app ticks by default. */
  defaultKinds: MeetingKind[];
  text: string;
  /** What the text could not be told — shown as a gap and a warning. */
  gaps: SuggestionGap[];
  /** Fingerprint of the dates and hours the text was made from. */
  facts: string;
  /** The event it comes from, to open it from the suggestion. */
  eventId: string | null;
  /**
   * Monday of the week of the thing itself (the event, the meeting, the
   * report): a «not needed» is kept at least until then, even when the
   * suggestion's own week is earlier.
   */
  anchorWeek: string;
}

export interface SuggestionEvent {
  id: string;
  type: string | null;
  date: string;
  endDate: string | null;
  time: string | null;
  coMidweekDow: number | null;
}

export interface SuggestionFieldServiceMeeting {
  date: string;
  time: string;
  published: boolean;
  cancelled: boolean;
  movedFromDate: string | null;
  notice: string | null;
}

export interface SuggestionAudit {
  /** «2026-Q1» — the quarter checked, as the calendar task names it. */
  period: string;
  /** The congregation's own day the task was ticked done. */
  doneOn: string;
}

export interface SuggestionInput {
  lang: SupportedLanguage;
  /** Week rules for every week the rules may look at, keyed by Monday. */
  weeks: Map<string, WeekRules>;
  events: SuggestionEvent[];
  fieldService: SuggestionFieldServiceMeeting[];
  audits: SuggestionAudit[];
}

/** How far ahead each topic is offered (R-09). */
export const WEEKS_AHEAD = {
  coVisit: 4,
  memorial: 5,
  convention: 10,
} as const;

/** How many weeks back from the target a rule may step to find meetings. */
const STEP_BACK = 3;

/** The quarter a calendar task checks: the months it covers (calendar-tasks). */
const AUDIT_MONTHS: Record<string, [number, number]> = {
  Q1: [9, 11],
  Q2: [12, 2],
  Q3: [3, 5],
  Q4: [6, 8],
};

export function factsOf(...parts: (string | number | null)[]): string {
  return createHash('sha256')
    .update(parts.map((p) => (p == null ? '' : String(p))).join('|'))
    .digest('hex')
    .slice(0, 16);
}

// ---- Words ---------------------------------------------------------------

function fmt(
  lang: SupportedLanguage,
  dateISO: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(lang, opts).format(
      new Date(`${dateISO}T12:00:00`),
    );
  } catch {
    return dateISO;
  }
}

const day = (lang: SupportedLanguage, d: string) =>
  fmt(lang, d, { day: 'numeric', month: 'long' });

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «9:00», never «09:00»: it is read aloud. */
function clock(time: string | null): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  return m ? `${Number(m[1])}:${m[2]}` : null;
}

/** «Суббота, 13 марта, 9:00» — or with the gap where the hour is missing. */
function when(
  lang: SupportedLanguage,
  w: SuggestionWords,
  date: string,
  time: string | null,
): { text: string; gap: boolean } {
  const weekday = capital(fmt(lang, date, { weekday: 'long' }));
  const hour = clock(time);
  return {
    text: `${weekday}, ${day(lang, date)}, ${hour ?? w.gapTime}`,
    gap: !hour,
  };
}

/** Inside a sentence: Russian weekdays are lower case; German and English keep theirs. */
function inner(lang: SupportedLanguage, s: string): string {
  return lang === 'ru' ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/**
 * Two days of one span, the month said once when it is the same: «5» and
 * «10 января», «5.» and «10. Januar», «January 5» and «10».
 */
function span(
  lang: SupportedLanguage,
  from: string,
  to: string,
): { from: string; to: string } {
  if (from.slice(0, 7) !== to.slice(0, 7))
    return { from: day(lang, from), to: day(lang, to) };
  const n = (d: string) => String(Number(d.slice(8, 10)));
  if (lang === 'en') return { from: day(lang, from), to: n(to) };
  if (lang === 'de') return { from: `${n(from)}.`, to: day(lang, to) };
  return { from: n(from), to: day(lang, to) };
}

function dates(lang: SupportedLanguage, from: string, to: string | null) {
  if (!to || to === from) return day(lang, from);
  const sp = span(lang, from, to);
  return `${sp.from} – ${sp.to}`;
}

function monthName(lang: SupportedLanguage, month: number, year: number) {
  const iso = `${year}-${String(month).padStart(2, '0')}-15`;
  return fmt(lang, iso, { month: 'long' });
}

// ---- Which meetings ------------------------------------------------------

type Pick = { week: string; meetings: { kind: MeetingKind; date: string }[] };

function meetingsOf(weeks: Map<string, WeekRules>, week: string) {
  return weeks.get(week)?.meetings ?? [];
}

/** The last week holding a meeting before `date`, with those meetings. */
export function lastWeekBefore(
  weeks: Map<string, WeekRules>,
  date: string,
): Pick | null {
  let w = mondayOf(date);
  for (let i = 0; i <= STEP_BACK; i++, w = addDaysISO(w, -7)) {
    if (!weeks.has(w)) return null;
    const ms = meetingsOf(weeks, w).filter((m) => m.date < date);
    if (ms.length) return { week: w, meetings: ms };
  }
  return null;
}

/** The week `n` weeks before the week of `date` — or the nearest one before it holding meetings. */
export function weeksBefore(
  weeks: Map<string, WeekRules>,
  date: string,
  n: number,
): Pick | null {
  let w = addDaysISO(mondayOf(date), -7 * n);
  for (let i = 0; i <= STEP_BACK; i++, w = addDaysISO(w, -7)) {
    if (!weeks.has(w)) return null;
    const ms = meetingsOf(weeks, w);
    if (ms.length) return { week: w, meetings: ms };
  }
  return null;
}

const kinds = (p: Pick) => p.meetings.map((m) => m.kind);

function midweekFirst(p: Pick): MeetingKind[] {
  return p.meetings.some((m) => m.kind === 'midweek')
    ? ['midweek']
    : [p.meetings[0].kind];
}

// ---- The rules -----------------------------------------------------------

export function suggestionsFrom(input: SuggestionInput): Suggestion[] {
  const { lang, weeks } = input;
  const w = SUGGESTION_WORDS[lang];
  const out: Suggestion[] = [];

  for (const e of input.events) {
    if (e.type === 'general_cleaning') {
      const p = lastWeekBefore(weeks, e.date);
      if (!p) continue;
      const at = when(lang, w, e.date, e.time);
      out.push({
        key: `general_cleaning:${e.id}`,
        topic: 'general_cleaning',
        stage: 'once',
        targetWeek: p.week,
        meetings: p.meetings,
        defaultKinds: kinds(p),
        text: w.generalCleaning({ when: at.text }),
        gaps: at.gap ? ['time'] : [],
        facts: factsOf(e.date, clock(e.time)),
        eventId: e.id,
        anchorWeek: mondayOf(e.date),
      });
    }

    if (e.type === 'circuit_overseer_visit') {
      const visitWeek = mondayOf(e.date);
      const rules = weeks.get(visitWeek);
      if (!rules) continue;
      const dow = visitMidweekDowOf(e);
      // The week rules alone say whether the midweek meeting is held that week
      // and when (an assembly in the visit week holds none).
      // dateOf names a day even for a meeting not held — ask the meetings held.
      const mwDate =
        rules.meetings.find((m) => m.kind === 'midweek')?.date ?? null;
      const mwTime = mwDate ? rules.timeOf('midweek') : null;
      const mw = mwDate ? when(lang, w, mwDate, mwTime) : null;
      const sp = span(lang, e.date, e.endDate ?? e.date);
      const words = {
        from: sp.from,
        to: sp.to,
        midweek: mw ? inner(lang, mw.text) : null,
      };
      // Raw values, not words: another language must not look like a change.
      const facts = factsOf(e.date, e.endDate, dow, mwDate, clock(mwTime));
      const next = lastWeekBefore(weeks, visitWeek);
      const ahead = weeksBefore(weeks, e.date, WEEKS_AHEAD.coVisit);
      if (ahead && (!next || ahead.week < next.week)) {
        out.push({
          key: `co_visit:ahead:${e.id}`,
          topic: 'co_visit',
          stage: 'ahead',
          targetWeek: ahead.week,
          meetings: ahead.meetings,
          defaultKinds: kinds(ahead),
          text: w.coVisitAhead(words),
          gaps: mw?.gap ? ['time'] : [],
          facts,
          eventId: e.id,
          anchorWeek: mondayOf(e.date),
        });
      }
      if (next) {
        out.push({
          key: `co_visit:next:${e.id}`,
          topic: 'co_visit',
          stage: 'next',
          targetWeek: next.week,
          meetings: next.meetings,
          defaultKinds: kinds(next),
          text: w.coVisitNext(words),
          gaps: mw?.gap ? ['time'] : [],
          facts,
          eventId: e.id,
          anchorWeek: mondayOf(e.date),
        });
      }
    }

    if (e.type === 'memorial') {
      const at = when(lang, w, e.date, e.time);
      const facts = factsOf(e.date, clock(e.time));
      const next = lastWeekBefore(weeks, mondayOf(e.date));
      const ahead = weeksBefore(weeks, e.date, WEEKS_AHEAD.memorial);
      if (ahead && (!next || ahead.week < next.week)) {
        out.push({
          key: `memorial:ahead:${e.id}`,
          topic: 'memorial',
          stage: 'ahead',
          targetWeek: ahead.week,
          meetings: ahead.meetings,
          defaultKinds: midweekFirst(ahead),
          text: w.memorialAhead({ when: inner(lang, at.text) }),
          gaps: at.gap ? ['time'] : [],
          facts,
          eventId: e.id,
          anchorWeek: mondayOf(e.date),
        });
      }
      if (next) {
        out.push({
          key: `memorial:next:${e.id}`,
          topic: 'memorial',
          stage: 'next',
          targetWeek: next.week,
          meetings: next.meetings,
          defaultKinds: kinds(next),
          text: w.memorialNext({ when: inner(lang, at.text) }),
          gaps: at.gap ? ['time'] : [],
          facts,
          eventId: e.id,
          anchorWeek: mondayOf(e.date),
        });
      }
    }

    if (e.type === 'circuit_assembly' || e.type === 'regional_convention') {
      const name =
        e.type === 'circuit_assembly'
          ? w.circuitAssembly
          : w.regionalConvention;
      const words = { name, dates: dates(lang, e.date, e.endDate) };
      const facts = factsOf(e.date, e.endDate);
      const next = lastWeekBefore(weeks, e.date);
      const ahead = weeksBefore(weeks, e.date, WEEKS_AHEAD.convention);
      if (ahead && (!next || ahead.week < next.week)) {
        out.push({
          key: `convention:ahead:${e.id}`,
          topic: 'convention',
          stage: 'ahead',
          targetWeek: ahead.week,
          meetings: ahead.meetings,
          defaultKinds: midweekFirst(ahead),
          text: w.conventionAhead(words),
          gaps: [],
          facts,
          eventId: e.id,
          anchorWeek: mondayOf(e.date),
        });
      }
      if (next) {
        out.push({
          key: `convention:next:${e.id}`,
          topic: 'convention',
          stage: 'next',
          targetWeek: next.week,
          meetings: next.meetings,
          defaultKinds: kinds(next),
          text: w.conventionNext(words),
          gaps: [],
          facts,
          eventId: e.id,
          anchorWeek: mondayOf(e.date),
        });
      }
    }
  }

  out.push(...fieldServiceSuggestions(input, w));
  out.push(...accountsSuggestions(input, w));
  return out;
}

/**
 * A published meeting for field service that was called off, moved, or
 * carries a word on what is different this time — told at the meetings
 * before it (R-08). Changes of hour or place are not told apart from other
 * edits, so they are not offered (R-09).
 */
function fieldServiceSuggestions(
  input: SuggestionInput,
  w: SuggestionWords,
): Suggestion[] {
  const { lang, weeks } = input;
  const out: Suggestion[] = [];
  const mondays = [...weeks.keys()].sort();
  for (const week of mondays) {
    const ms = meetingsOf(weeks, week);
    if (!ms.length) continue;
    const from = ms[0].date;
    // Up to the first meeting of the next week that has one.
    let until = addDaysISO(week, 13);
    for (let n = addDaysISO(week, 7); weeks.has(n); n = addDaysISO(n, 7)) {
      const nm = meetingsOf(weeks, n);
      if (nm.length) {
        until = nm[0].date;
        break;
      }
    }
    const changed = input.fieldService
      .filter(
        (f) =>
          f.published &&
          f.date > from &&
          f.date <= until &&
          (f.cancelled || !!f.movedFromDate || !!f.notice?.trim()),
      )
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    if (!changed.length) continue;
    const meetings = ms.filter((m) => m.date < changed[0].date);
    if (!meetings.length) continue;
    const lines = changed.map((f) => {
      const at = when(lang, w, f.date, f.time).text;
      if (f.cancelled) return w.fieldServiceCancelled({ when: at });
      if (f.movedFromDate)
        return w.fieldServiceMoved({
          when: at,
          from: day(lang, f.movedFromDate),
        });
      return w.fieldServiceNotice({ when: at, notice: f.notice!.trim() });
    });
    out.push({
      key: `field_service:${week}`,
      topic: 'field_service',
      stage: 'once',
      targetWeek: week,
      meetings,
      defaultKinds: [meetings[0].kind],
      text: lines.join(' '),
      gaps: [],
      facts: factsOf(...lines),
      eventId: null,
      anchorWeek: week,
    });
  }
  return out;
}

/** The monthly accounts report and «the audit has been done» (R-04). */
function accountsSuggestions(
  input: SuggestionInput,
  w: SuggestionWords,
): Suggestion[] {
  const { lang, weeks } = input;
  const out: Suggestion[] = [];
  const mondays = [...weeks.keys()].sort();
  const firstMidweekFrom = (date: string): Pick | null => {
    for (const week of mondays) {
      const ms = meetingsOf(weeks, week);
      const mw = ms.find((m) => m.kind === 'midweek' && m.date >= date);
      if (mw) return { week, meetings: ms.filter((m) => m.date >= date) };
      const any = ms.find((m) => m.date >= date);
      if (any && ms.every((m) => m.kind !== 'midweek'))
        return { week, meetings: ms.filter((m) => m.date >= date) };
    }
    return null;
  };

  // Each month's first midweek meeting carries the report on the month before.
  const months = new Set(mondays.map((m) => addDaysISO(m, 6).slice(0, 7)));
  for (const ym of months) {
    // The week of the 1st must be in view, or the «first» meeting found would
    // be a later one — a month already begun would be reported mid-month.
    if (!weeks.has(mondayOf(`${ym}-01`))) continue;
    const p = firstMidweekFrom(`${ym}-01`);
    if (!p || p.meetings[0].date.slice(0, 7) !== ym) continue;
    const [y, m] = ym.split('-').map(Number);
    const prevY = m === 1 ? y - 1 : y;
    const prevM = m === 1 ? 12 : m - 1;
    const prev = `${prevY}-${String(prevM).padStart(2, '0')}`;
    out.push({
      key: `accounts_month:${prev}`,
      topic: 'accounts_month',
      stage: 'once',
      targetWeek: p.week,
      meetings: p.meetings,
      defaultKinds: midweekFirst(p),
      text: w.accountsMonth({
        month: monthName(lang, prevM, prevY),
        report: w.gapReport,
      }),
      gaps: ['report'],
      facts: factsOf(prev),
      eventId: null,
      anchorWeek: p.week,
    });
  }

  for (const a of input.audits) {
    const q = /^(\d{4})-(Q[1-4])$/.exec(a.period);
    if (!q) continue;
    const after = addDaysISO(a.doneOn, 1);
    if (!weeks.has(mondayOf(after))) continue;
    const p = firstMidweekFrom(after);
    if (!p) continue;
    const year = Number(q[1]);
    const [m1, m2] = AUDIT_MONTHS[q[2]];
    // Q2 runs December to February and is named after the year it ends in.
    const y1 = m1 > m2 ? year - 1 : year;
    const months = `${monthName(lang, m1, y1)} – ${monthName(lang, m2, year)}`;
    out.push({
      key: `accounts_audit:${a.period}`,
      topic: 'accounts_audit',
      stage: 'once',
      targetWeek: p.week,
      meetings: p.meetings,
      defaultKinds: midweekFirst(p),
      text: w.accountsAudit({ months }),
      gaps: [],
      facts: factsOf(a.period),
      eventId: null,
      anchorWeek: p.week,
    });
  }
  return out;
}

import { createHash } from 'crypto';
import { SupportedLanguage } from '../common/i18n/supported-languages';
import { addDaysISO } from '../common/week-rules';
import type { AgendaItem } from '../agenda/agenda.types';

/**
 * The calendar feed as text (RFC 5545), from an agenda.
 *
 * Pure: no database, no clock of its own — every input is passed in, so each
 * rule here has a test and the feed reads the same for the same agenda.
 *
 * Times are written in UTC («…Z»). A calendar shows them in the phone's own
 * zone, which for a member of the congregation is the congregation's, and a
 * UTC time needs no VTIMEZONE block — the block that Google, Apple and
 * Outlook each read a little differently.
 */

export interface FeedOptions {
  /** Things the person holds. */
  mine: boolean;
  /** Conventions, visits, the Memorial. */
  events: boolean;
  /** «вместе с …». */
  names: boolean;
}

export interface FeedContext {
  lang: SupportedLanguage;
  /** The congregation's timezone, IANA. */
  timezone: string;
  /** The congregation's name, for the calendar's own name. */
  congregation: string;
  /** Where «Открыть в приложении» leads. */
  appUrl: string;
  /** When this text was made — «актуально на». */
  now: Date;
}

interface Words {
  calendar: (c: string) => string;
  midweek: string;
  weekend: string;
  memorial: string;
  andMore: (n: number) => string;
  away: string;
  awayHint: string;
  with: string;
  yourPart: string;
  open: string;
  asOf: (when: string) => string;
}

const WORDS: Record<SupportedLanguage, Words> = {
  ru: {
    calendar: (c) => `Собрание ${c}`,
    midweek: 'встреча буднего дня',
    weekend: 'встреча выходного дня',
    memorial: 'Вечеря воспоминания',
    andMore: (n) => ` и ещё ${n}`,
    away: 'вы в отъезде',
    awayHint: 'Вы отметили, что в этот день вас не будет: сообщите о замене.',
    with: 'вместе',
    yourPart: 'У вас',
    open: 'Открыть в приложении',
    asOf: (w) => `Актуально на ${w} · mycongregation.org`,
  },
  en: {
    calendar: (c) => `${c} congregation`,
    midweek: 'midweek meeting',
    weekend: 'weekend meeting',
    memorial: 'Memorial',
    andMore: (n) => ` and ${n} more`,
    away: 'you are away',
    awayHint:
      'You marked yourself away that day: please arrange a replacement.',
    with: 'with',
    yourPart: 'Yours',
    open: 'Open in the app',
    asOf: (w) => `As of ${w} · mycongregation.org`,
  },
  de: {
    calendar: (c) => `Versammlung ${c}`,
    midweek: 'Zusammenkunft unter der Woche',
    weekend: 'Zusammenkunft am Wochenende',
    memorial: 'Gedächtnismahl',
    andMore: (n) => ` und ${n} weitere`,
    away: 'Sie sind abwesend',
    awayHint:
      'Sie haben sich für diesen Tag abwesend gemeldet: bitte um Vertretung kümmern.',
    with: 'mit',
    yourPart: 'Ihre Aufgabe',
    open: 'In der App öffnen',
    asOf: (w) => `Stand: ${w} · mycongregation.org`,
  },
};

// ── RFC 5545 text ───────────────────────────────────────────────────────────

/** Escapes a TEXT value: backslash, semicolon, comma, line breaks. */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds a content line at 75 OCTETS (RFC 5545 §3.1), never inside a UTF-8
 * character: a Cyrillic letter is two octets, and a calendar that receives
 * half of one shows «�» in the middle of a name.
 */
export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = '';
  let octets = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (octets + n > limit) {
      out.push(cur);
      cur = '';
      octets = 0;
      limit = 74; // the leading space of a continuation counts
    }
    cur += ch;
    octets += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** The offset of a zone from UTC at an instant, in minutes. */
function offsetMinutes(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** A wall-clock time of the congregation as an instant (the summer-time change included). */
export function zonedToUtc(date: string, hhmm: string, timezone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let at = new Date(wall - offsetMinutes(new Date(wall), timezone) * 60000);
  // Once more from the first guess: right across the change of the clocks.
  at = new Date(wall - offsetMinutes(at, timezone) * 60000);
  return at;
}

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
const dateValue = (iso: string) => iso.replace(/-/g, '');

// ── Events from the agenda ─────────────────────────────────────────────────

interface VEvent {
  uid: string;
  summary: string;
  description: string;
  location: string | null;
  url: string | null;
  allDay: boolean;
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM-DD, inclusive; all-day only. */
  endDate: string;
  start: string | null;
  end: string | null;
}

/** The meeting's name for the title: «… — встреча буднего дня». */
function meetingName(w: Words, meeting: AgendaItem['meeting']): string | null {
  if (meeting === 'midweek') return w.midweek;
  if (meeting === 'weekend') return w.weekend;
  if (meeting === 'memorial') return w.memorial;
  return null;
}

function lineOf(it: AgendaItem, w: Words, names: boolean): string {
  const bits = [it.title];
  if (it.detail) bits.push(it.detail);
  let s = bits.join(' · ');
  if (names && it.with.length) s += ` (${w.with}: ${it.with.join(', ')})`;
  return s;
}

/**
 * The agenda as calendar events, by the rules decided on 7 November 2026:
 * a meeting is ONE event with the person's parts inside; a meeting not held
 * is not in the calendar; a day away is, with a warning; big events lie
 * across their days.
 */
export function eventsOf(
  items: AgendaItem[],
  opts: FeedOptions,
  ctx: Pick<FeedContext, 'lang' | 'appUrl' | 'now' | 'timezone'>,
): VEvent[] {
  const w = WORDS[ctx.lang];
  const out: VEvent[] = [];
  const asOf = w.asOf(
    new Intl.DateTimeFormat(ctx.lang, {
      timeZone: ctx.timezone,
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(ctx.now),
  );
  const tail = ['', `${w.open}: ${ctx.appUrl}`, asOf];

  const mine = opts.mine
    ? items.filter((i) => i.scope === 'mine' && i.state !== 'not_held')
    : [];
  const events = opts.events ? items.filter((i) => i.scope === 'event') : [];

  // One event per meeting: its parts, duties and the cleaning after it.
  const byMeeting = new Map<string, AgendaItem[]>();
  for (const it of mine) {
    if (!it.meetingKey) continue;
    byMeeting.set(it.meetingKey, [...(byMeeting.get(it.meetingKey) ?? []), it]);
  }
  const memorialEvent = new Map(
    events.filter((e) => e.meetingKey).map((e) => [e.meetingKey!, e]),
  );

  for (const [key, group] of byMeeting) {
    const first = group[0];
    const meeting = meetingName(w, first.meeting);
    const away = group.some((i) => i.state === 'away');
    const head =
      group.length > 1
        ? `${first.title}${w.andMore(group.length - 1)}`
        : first.title;
    const starts = group.map((i) => i.start).filter((x): x is string => !!x);
    const ends = group.map((i) => i.end).filter((x): x is string => !!x);
    const start = starts.length ? starts.sort()[0] : null;
    const end = ends.length ? ends.sort()[ends.length - 1] : null;
    out.push({
      uid: `${key}@mycongregation.org`,
      summary: `${away ? `⚠ ${w.away}: ` : ''}${head}${meeting ? ` — ${meeting}` : ''}`,
      description: [
        ...(away ? [w.awayHint, ''] : []),
        `${w.yourPart}:`,
        ...group.map((i) => `• ${lineOf(i, w, opts.names)}`),
        ...tail,
      ].join('\n'),
      location: group.find((i) => i.place)?.place ?? null,
      url: ctx.appUrl,
      allDay: !start,
      date: first.date,
      endDate: first.date,
      start,
      end,
    });
    // The Memorial is now this event; do not show it twice.
    memorialEvent.delete(key);
  }

  for (const it of mine) {
    if (it.meetingKey) continue;
    const away = it.state === 'away';
    out.push({
      uid: `${it.id}@mycongregation.org`,
      summary: `${away ? `⚠ ${w.away}: ` : ''}${it.title}`,
      description: [
        ...(away ? [w.awayHint, ''] : []),
        ...(it.detail ? [it.detail] : []),
        ...(opts.names && it.with.length
          ? [`${w.with}: ${it.with.join(', ')}`]
          : []),
        ...tail,
      ]
        .join('\n')
        .replace(/^\n+/, ''),
      location: it.place,
      url: ctx.appUrl,
      allDay: !it.start,
      date: it.date,
      endDate: it.endDate ?? it.date,
      start: it.start,
      end: it.end,
    });
  }

  for (const e of events) {
    if (e.meetingKey && !memorialEvent.has(e.meetingKey)) continue;
    out.push({
      uid: `${e.id}@mycongregation.org`,
      summary: e.title,
      description: [...(e.detail ? [e.detail] : []), ...tail]
        .join('\n')
        .replace(/^\n+/, ''),
      location: e.place,
      url: ctx.appUrl,
      allDay: !e.start,
      date: e.date,
      endDate: e.endDate ?? e.date,
      start: e.start,
      end: e.end,
    });
  }
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.start ?? '').localeCompare(b.start ?? '') ||
      a.uid.localeCompare(b.uid),
  );
}

/** The whole VCALENDAR. */
export function buildIcs(
  items: AgendaItem[],
  opts: FeedOptions,
  ctx: FeedContext,
): string {
  const w = WORDS[ctx.lang];
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//mycongregation.org//calendar feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(w.calendar(ctx.congregation))}`,
    `X-WR-TIMEZONE:${ctx.timezone}`,
    // A hint only — Google decides for itself (about every 8–24 hours).
    'REFRESH-INTERVAL;VALUE=DURATION:PT3H',
    'X-PUBLISHED-TTL:PT3H',
  ];
  const dtstamp = stamp(ctx.now);
  for (const e of eventsOf(items, opts, ctx)) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${dtstamp}`);
    if (e.allDay) {
      lines.push(
        `DTSTART;VALUE=DATE:${dateValue(e.date)}`,
        // DTEND of a whole day is exclusive: the day after the last one.
        `DTEND;VALUE=DATE:${dateValue(addDaysISO(e.endDate, 1))}`,
      );
    } else {
      const start = zonedToUtc(e.date, e.start!, ctx.timezone);
      const end = e.end
        ? zonedToUtc(e.date, e.end, ctx.timezone)
        : new Date(start.getTime() + 60 * 60000);
      lines.push(
        `DTSTART:${stamp(start)}`,
        `DTEND:${stamp(end > start ? end : new Date(start.getTime() + 60 * 60000))}`,
      );
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * A tag for HTTP caching: the events as they would read, without the moment
 * they were made. Same agenda, same tag — so a calendar asking every few
 * hours gets «304, nothing new» until something really changes.
 */
export function feedTag(items: AgendaItem[], opts: FeedOptions, lang: string) {
  return (
    '"' +
    createHash('sha256')
      .update(JSON.stringify({ items, opts, lang }))
      .digest('base64url')
      .slice(0, 27) +
    '"'
  );
}

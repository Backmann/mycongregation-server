/**
 * When could the two people of a part prepare it together? (10 November 2026)
 *
 * Only moments the congregation already has — its meetings and its field
 * service meetings — and never a place of anybody's own: a pair can be a
 * young student and an older sister, and the app does not arrange private
 * meetings between people. «We'll arrange it ourselves» is always there.
 *
 * Pure: calendar strings in, options out. The service gathers the facts.
 */

export type OptionKind = 'after' | 'before' | 'service' | 'self';

export interface PrepOption {
  /** What the app sends back to choose it: kind:date:meeting or service:id. */
  key: string;
  kind: OptionKind;
  date: string | null;
  time: string | null;
  meeting: 'midweek' | 'weekend' | null;
}

export type HiddenReason = 'my_duty' | 'partner_duty' | 'cleaning' | 'away';

export interface HiddenOption {
  date: string;
  kind: OptionKind;
  meeting: 'midweek' | 'weekend' | null;
  reason: HiddenReason;
}

export interface MeetingFact {
  date: string;
  kind: 'midweek' | 'weekend';
  time: string | null;
  weekStart: string;
}

export interface ServiceFact {
  id: string;
  date: string;
  time: string;
}

export interface PrepFacts {
  /** The congregation's today and its minute of the day. */
  today: string;
  nowMinutes: number;
  /** The part's own meeting. */
  part: MeetingFact;
  /** Meetings held from today up to and including the part's. */
  meetings: MeetingFact[];
  /** Published, not called off. */
  services: ServiceFact[];
  /** Meetings at which I / the partner have a duty: `${weekStart}|${kind}`. */
  myDuties: Set<string>;
  partnerDuties: Set<string>;
  /** Weeks whose cleaning after the meetings falls to either one's group. */
  cleaningWeeks: Set<string>;
  /** Is either of the two away on this day? */
  away: (date: string) => boolean;
}

/** How many meetings, and how many field service meetings, are offered. */
export const MAX_MEETINGS = 4;
export const MAX_SERVICES = 2;
/** No sooner than this many days before the part. */
export const WINDOW_DAYS = 21;

const minutesOf = (hhmm: string | null): number | null => {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Not yet begun: a moment of today counts only while it is still ahead. */
function ahead(f: PrepFacts, date: string, time: string | null): boolean {
  if (date > f.today) return true;
  if (date < f.today) return false;
  const m = minutesOf(time);
  return m === null ? true : m > f.nowMinutes;
}

export function prepOptions(f: PrepFacts): {
  options: PrepOption[];
  hidden: HiddenOption[];
} {
  const from = [f.today, addDays(f.part.date, -WINDOW_DAYS)].sort()[1];
  const hidden: HiddenOption[] = [];
  const meetingOptions: PrepOption[] = [];

  for (const m of [...f.meetings].sort((a, b) =>
    a.date === b.date ? a.kind.localeCompare(b.kind) : a.date < b.date ? -1 : 1,
  )) {
    if (m.date < from || m.date > f.part.date) continue;
    const own = m.date === f.part.date && m.kind === f.part.kind;
    // After the part's own meeting there is nothing left to prepare.
    if (!own && m.date === f.part.date) continue;
    const kind: OptionKind = own ? 'before' : 'after';
    // «After» a meeting of today is still possible while it has not begun;
    // «before» the part's own meeting likewise.
    if (!ahead(f, m.date, m.time)) continue;
    const at = `${m.weekStart}|${m.kind}`;
    const reason: HiddenReason | null = f.away(m.date)
      ? 'away'
      : f.myDuties.has(at)
        ? 'my_duty'
        : f.partnerDuties.has(at)
          ? 'partner_duty'
          : kind === 'after' && f.cleaningWeeks.has(m.weekStart)
            ? 'cleaning'
            : null;
    if (reason) {
      hidden.push({ date: m.date, kind, meeting: m.kind, reason });
      continue;
    }
    meetingOptions.push({
      key: `${kind}:${m.date}:${m.kind}`,
      kind,
      date: m.date,
      time: m.time,
      meeting: m.kind,
    });
  }

  // The meetings nearest to the part, and the part's own last of all.
  const before = meetingOptions.filter((o) => o.kind === 'before');
  const after = meetingOptions
    .filter((o) => o.kind === 'after')
    .slice(-(MAX_MEETINGS - before.length));

  const serviceOptions: PrepOption[] = [];
  for (const s of [...f.services].sort((a, b) =>
    a.date === b.date ? a.time.localeCompare(b.time) : a.date < b.date ? -1 : 1,
  )) {
    if (s.date < from || s.date >= f.part.date) continue;
    if (!ahead(f, s.date, s.time)) continue;
    if (f.away(s.date)) {
      hidden.push({
        date: s.date,
        kind: 'service',
        meeting: null,
        reason: 'away',
      });
      continue;
    }
    serviceOptions.push({
      key: `service:${s.id}`,
      kind: 'service',
      date: s.date,
      time: s.time,
      meeting: null,
    });
  }
  // One a day, the latest before the part: a morning with three groups is
  // one moment to the two of them.
  const byDay = new Map<string, PrepOption>();
  for (const s of serviceOptions)
    if (!byDay.has(s.date!)) byDay.set(s.date!, s);
  const services = [...byDay.values()].slice(-MAX_SERVICES);

  const dated = [...after, ...services, ...before].sort((a, b) => {
    const ka = `${a.date} ${a.time ?? ''}`;
    const kb = `${b.date} ${b.time ?? ''}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return {
    options: [
      ...dated,
      { key: 'self', kind: 'self', date: null, time: null, meeting: null },
    ],
    hidden,
  };
}

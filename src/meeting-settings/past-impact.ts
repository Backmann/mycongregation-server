import { mondayOf } from '../common/week';
import { addDaysISO } from '../common/week-rules';

/**
 * What saving a schedule version would change in weeks that have already
 * begun (26 September).
 *
 * A version dated in the past is sometimes exactly right — a change of hall
 * or time entered a few weeks late, or a mistake in the version in force,
 * which is corrected by saving it again with the same date. So it is not
 * forbidden. But past weeks are read through the version in force then
 * (week rules, the attendance sheet, duties), and one thing cannot be put
 * right afterwards: attendance is stored under the DATE of the meeting, so
 * moving a meeting to another weekday leaves the figures already recorded on
 * dates that no longer hold a meeting. That is counted here, so the screen
 * can say it before saving and the server can refuse it unless confirmed.
 *
 * Week by week, the same way week-rules picks a version: the one with the
 * latest start on or before the week's Monday (a version dated on a Wednesday
 * takes effect the following Monday), and before the first version, the first.
 */
export interface ScheduleFields {
  effectiveFrom: string;
  midweekDow: number;
  midweekTime: string;
  weekendDow: number;
  weekendTime: string;
  address: string;
  microphoneSlots: number;
}

export type ChangedField =
  | 'midweekDow'
  | 'midweekTime'
  | 'weekendDow'
  | 'weekendTime'
  | 'address'
  | 'microphoneSlots';

const FIELDS: ChangedField[] = [
  'midweekDow',
  'midweekTime',
  'weekendDow',
  'weekendTime',
  'address',
  'microphoneSlots',
];

export interface PastImpact {
  /** Weeks already begun whose schedule would change. */
  weeks: number;
  /** Monday of the first and the last such week. */
  from: string | null;
  to: string | null;
  /** Each field that changes, with every distinct «was → becomes» pair. */
  changes: { field: ChangedField; was: string; becomes: string }[];
  /**
   * Attendance already recorded on a meeting day that the change moves to
   * another weekday — figures left on dates with no meeting.
   */
  attendanceOnMovedDays: number;
}

function versionForWeek<T extends { effectiveFrom: string }>(
  sorted: T[],
  monday: string,
): T | null {
  let found: T | null = null;
  for (const v of sorted) if (v.effectiveFrom <= monday) found = v;
  return found ?? sorted[0] ?? null;
}

function isoDow(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The first Monday on or after a date. */
function firstMondayFrom(date: string): string {
  const m = mondayOf(date);
  return m === date ? m : addDaysISO(m, 7);
}

export function pastImpact(input: {
  existing: ScheduleFields[];
  candidate: ScheduleFields;
  today: string;
  attendance: { date: string; eventType: string }[];
}): PastImpact {
  const { existing, candidate, today, attendance } = input;
  const sort = (xs: ScheduleFields[]) =>
    [...xs].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const before = sort(existing);
  const after = sort([
    ...existing.filter((v) => v.effectiveFrom !== candidate.effectiveFrom),
    candidate,
  ]);

  const none: PastImpact = {
    weeks: 0,
    from: null,
    to: null,
    changes: [],
    attendanceOnMovedDays: 0,
  };
  const thisMonday = mondayOf(today);
  // Where a difference can begin: where the candidate takes effect — or, if
  // it becomes the first version of all, the old first one, since the weeks
  // before any version fall back to the first.
  let start = firstMondayFrom(candidate.effectiveFrom);
  if (before.length && candidate.effectiveFrom < before[0].effectiveFrom) {
    start =
      mondayOf(before[0].effectiveFrom) < start
        ? mondayOf(before[0].effectiveFrom)
        : start;
  }
  if (start > thisMonday) return none;

  const pairs = new Map<
    string,
    { field: ChangedField; was: string; becomes: string }
  >();
  const movedWeeks: {
    monday: string;
    kind: 'midweek' | 'weekend';
    oldDow: number;
  }[] = [];
  let weeks = 0;
  let from: string | null = null;
  let to: string | null = null;
  for (
    let monday = start;
    monday <= thisMonday;
    monday = addDaysISO(monday, 7)
  ) {
    const was = versionForWeek(before, monday);
    const becomes = versionForWeek(after, monday);
    if (!becomes) continue;
    let changed = false;
    for (const f of FIELDS) {
      const a = was ? String(was[f]) : '';
      const b = String(becomes[f]);
      if (a === b) continue;
      changed = true;
      pairs.set(`${f}|${a}|${b}`, { field: f, was: a, becomes: b });
    }
    if (!changed) continue;
    weeks += 1;
    from = from ?? monday;
    to = monday;
    if (was && was.midweekDow !== becomes.midweekDow) {
      movedWeeks.push({ monday, kind: 'midweek', oldDow: was.midweekDow });
    }
    if (was && was.weekendDow !== becomes.weekendDow) {
      movedWeeks.push({ monday, kind: 'weekend', oldDow: was.weekendDow });
    }
  }

  // A recorded figure sits on the OLD weekday of a week whose meeting moves.
  // Weeks where a visit or an event had already moved the meeting elsewhere
  // are left alone by this test: their figure is not on the old weekday.
  let attendanceOnMovedDays = 0;
  for (const row of attendance) {
    const monday = mondayOf(row.date);
    if (
      movedWeeks.some(
        (w) =>
          w.monday === monday &&
          w.kind === row.eventType &&
          isoDow(row.date) === w.oldDow,
      )
    ) {
      attendanceOnMovedDays += 1;
    }
  }

  return {
    weeks,
    from,
    to,
    changes: [...pairs.values()],
    attendanceOnMovedDays,
  };
}

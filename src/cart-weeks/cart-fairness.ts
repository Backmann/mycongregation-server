import {
  CAPACITY_MAX,
  MIN_SPAN,
  Span,
  STEP,
  coverage,
  halfHours,
  overlaps,
  toHHMM,
  toMin,
} from './cart-time';

/**
 * Who goes first when more want a time than it holds (Lionel, 2 November
 * 2026). Pioneers have priority — but nobody is left out for weeks:
 *
 *  1. only who can stand at all: not away that day, not elsewhere at that
 *     hour (the caller leaves the others out);
 *  2. pioneers — regular, special, missionary, auxiliary this month — and
 *     whoever asked and got nothing three weeks running;
 *  3. then whoever asked and got nothing two weeks running;
 *  4. then the rest, fewest days at the stand in eight weeks first, longest
 *     ago first;
 *  5. a person with two shifts this week already gives way to one with none;
 *  6. only then, all else equal: beside whom he asked to stand with, or who
 *     asked for him (Lionel, 2 November 2026: «да, после всех правил»).
 *
 * Whoever arranges sees the proposal and changes what he likes; this only
 * lays it out.
 */

export interface PersonStanding {
  publisherId: string;
  /** A pioneer on some day of the week — what the screen shows beside him. */
  pioneer: boolean;
  /**
   * By the month of the DAY (4 November 2026): an auxiliary pioneer in
   * November only is not one on Friday 30 October. Keyed 'YYYY-MM' for the
   * months the week touches; a month missing here falls back to `pioneer`.
   */
  pioneerIn?: Record<string, boolean>;
  /** Weeks in a row he asked and was not put on (0 when he was). */
  missedWeeks: number;
  /** Days at the stand in the eight weeks before. */
  recentDays: number;
  lastDate: string | null;
}

export interface Wish {
  id: string;
  publisherId: string;
  dayId: string;
  date: string;
  startTime: string;
  endTime: string;
  createdAt: number;
  /** Whom he asked to stand with, by card. */
  with?: string[];
}

export interface Placed {
  dayId: string;
  publisherId: string | null;
  date: string;
  startTime: string;
  endTime: string;
}

export interface DayFrame {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Called-off spans of the day: nobody is put there. */
  off: Span[];
}

/** Pioneer on this date — by its month when known, else for the week. */
export function pioneerOn(p: PersonStanding, date?: string): boolean {
  const byMonth = date ? p.pioneerIn?.[date.slice(0, 7)] : undefined;
  return byMonth ?? p.pioneer;
}

export function tierOf(p: PersonStanding | undefined, date?: string): number {
  if (!p) return 2;
  if (pioneerOn(p, date) || p.missedWeeks >= 3) return 0;
  if (p.missedWeeks >= 2) return 1;
  return 2;
}

export function rankKey(
  p: PersonStanding | undefined,
  weekLoad: number,
  createdAt: number,
  /** 0 — the one he asked for (or who asked for him) already stands then. */
  besidePartner = 1,
  /** The day asked for, so a pioneer is judged by that day's month. */
  date?: string,
): (number | string)[] {
  return [
    weekLoad >= 2 ? 1 : 0,
    tierOf(p, date),
    weekLoad,
    p?.recentDays ?? 0,
    p?.lastDate ?? '',
    besidePartner,
    createdAt,
  ];
}

function cmp(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Lays the wishes onto the days. Returns only what it ADDS: the places
 * already on the plan stay as they are.
 */
export function suggest(
  days: DayFrame[],
  wishes: Wish[],
  placed: Placed[],
  standing: Map<string, PersonStanding>,
  /** Wishes already granted, for whom they asked to stand with. */
  asked: Pick<Wish, 'dayId' | 'publisherId' | 'with'>[] = [],
): Placed[] {
  const all: Placed[] = [...placed];
  const added: Placed[] = [];
  const dayById = new Map(days.map((d) => [d.id, d]));
  const load = new Map<string, number>();
  for (const p of placed) {
    if (p.publisherId)
      load.set(p.publisherId, (load.get(p.publisherId) ?? 0) + 1);
  }

  const fits = (
    w: { dayId: string; publisherId: string; date: string },
    span: Span,
  ) => {
    const day = dayById.get(w.dayId);
    if (!day) return false;
    if (day.off.some((o) => overlaps(o, span))) return false;
    // Not elsewhere at that hour, on any day of that date.
    if (
      all.some(
        (p) =>
          p.publisherId === w.publisherId &&
          p.date === w.date &&
          overlaps(p, span),
      )
    ) {
      return false;
    }
    const here = all.filter((p) => p.dayId === w.dayId);
    const c = coverage(day, here);
    return halfHours(span).every((t) => (c.get(t) ?? 0) < CAPACITY_MAX);
  };
  const place = (w: Wish, span: Span) => {
    const p: Placed = {
      dayId: w.dayId,
      publisherId: w.publisherId,
      date: w.date,
      ...span,
    };
    all.push(p);
    added.push(p);
    load.set(w.publisherId, (load.get(w.publisherId) ?? 0) + 1);
  };

  // Who asked for whom, both ways and day by day: a pair is a pair whoever
  // named whom. From every wish of the week — also those already granted,
  // which are not in `wishes` any more but still say whom they wanted.
  const wanted = new Map<string, Set<string>>();
  const key = (dayId: string, who: string) => `${dayId}|${who}`;
  const pair = (dayId: string, a: string, b: string) => {
    if (a === b) return;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const k = key(dayId, x);
      if (!wanted.has(k)) wanted.set(k, new Set());
      wanted.get(k)!.add(y);
    }
  };
  for (const w of [...wishes, ...asked]) {
    for (const o of w.with ?? []) pair(w.dayId, w.publisherId, o);
  }
  const beside = (w: Wish): number => {
    const mates = wanted.get(key(w.dayId, w.publisherId));
    if (!mates) return 1;
    return all.some(
      (p) =>
        p.dayId === w.dayId &&
        !!p.publisherId &&
        mates.has(p.publisherId) &&
        overlaps(p, w),
    )
      ? 0
      : 1;
  };

  // The wishes, best first, each taken whole where it fits; the order is
  // asked again after every placing, because a person's load grows.
  let left = [...wishes];
  for (;;) {
    left = left.filter((w) => dayById.has(w.dayId));
    if (left.length === 0) break;
    left.sort((a, b) =>
      cmp(
        rankKey(
          standing.get(a.publisherId),
          load.get(a.publisherId) ?? 0,
          a.createdAt,
          beside(a),
          a.date,
        ),
        rankKey(
          standing.get(b.publisherId),
          load.get(b.publisherId) ?? 0,
          b.createdAt,
          beside(b),
          b.date,
        ),
      ),
    );
    const i = left.findIndex((w) => fits(w, w));
    if (i < 0) break;
    const [w] = left.splice(i, 1);
    place(w, { startTime: w.startTime, endTime: w.endTime });
  }

  // Then nobody alone where it can be helped: a wish that did not fit whole
  // may still cover the lonely part of the day, an hour or more of it.
  for (const day of days) {
    for (;;) {
      const here = all.filter((p) => p.dayId === day.id);
      const c = coverage(day, here);
      const lone = [...c.entries()].filter(([, n]) => n === 1).map(([t]) => t);
      if (lone.length === 0) break;
      let done = false;
      for (const w of left.filter((x) => x.dayId === day.id)) {
        // The longest run inside his wish where he fits, touching a lone
        // half-hour.
        let best: Span | null = null;
        for (const t of lone) {
          if (t < toMin(w.startTime) || t >= toMin(w.endTime)) continue;
          let a = t;
          let b = t + STEP;
          while (
            a - STEP >= toMin(w.startTime) &&
            fits(w, { startTime: toHHMM(a - STEP), endTime: toHHMM(b) })
          )
            a -= STEP;
          while (
            b + STEP <= toMin(w.endTime) &&
            fits(w, { startTime: toHHMM(a), endTime: toHHMM(b + STEP) })
          )
            b += STEP;
          const span = { startTime: toHHMM(a), endTime: toHHMM(b) };
          if (b - a >= MIN_SPAN && fits(w, span)) {
            if (!best || b - a > toMin(best.endTime) - toMin(best.startTime))
              best = span;
          }
        }
        if (best) {
          place(w, best);
          left = left.filter((x) => x !== w);
          done = true;
          break;
        }
      }
      if (!done) break;
    }
  }
  return added;
}

/**
 * Time at the stand, on the half-hour (2 November 2026).
 *
 * A day at a place has its hours; people stand spans of it, from — to, an
 * hour or more, starting and ending on the half-hour. Every rule about «how
 * many stand» and «is he somewhere else» is asked per half-hour of the day,
 * so it holds whatever lengths people chose. Pure functions, tested on their
 * own.
 */

export const STEP = 30;
export const MIN_SPAN = 60;
export const CAPACITY_MAX = 4;
/** More than this many minutes for one person on one day: a soft warning. */
export const LONG_DAY_MINUTES = 180;

export interface Span {
  startTime: string;
  endTime: string;
}

export function toMin(hhmm: string): number {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

export function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** «HH:MM» on the half-hour. */
export function isHalfHour(hhmm: unknown): hhmm is string {
  if (typeof hhmm !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) {
    return false;
  }
  return toMin(hhmm) % STEP === 0;
}

/** Why a span cannot be taken in this day, or null when it can. */
export function spanProblem(
  span: Span,
  day: Span,
): 'NOT_HALF_HOUR' | 'TOO_SHORT' | 'OUTSIDE_DAY' | null {
  if (!isHalfHour(span.startTime) || !isHalfHour(span.endTime)) {
    return 'NOT_HALF_HOUR';
  }
  const a = toMin(span.startTime);
  const b = toMin(span.endTime);
  if (b - a < MIN_SPAN) return 'TOO_SHORT';
  if (a < toMin(day.startTime) || b > toMin(day.endTime)) return 'OUTSIDE_DAY';
  return null;
}

export function overlaps(a: Span, b: Span): boolean {
  return (
    toMin(a.startTime) < toMin(b.endTime) &&
    toMin(b.startTime) < toMin(a.endTime)
  );
}

export function minutes(s: Span): number {
  return toMin(s.endTime) - toMin(s.startTime);
}

/** The half-hours a span covers, as minutes from midnight. */
export function halfHours(s: Span): number[] {
  const out: number[] = [];
  for (let t = toMin(s.startTime); t < toMin(s.endTime); t += STEP) out.push(t);
  return out;
}

/** What remains of a span once the called-off parts are taken out. */
export function minus(span: Span, off: Span[]): Span[] {
  let parts: [number, number][] = [
    [toMin(span.startTime), toMin(span.endTime)],
  ];
  for (const o of off) {
    const oa = toMin(o.startTime);
    const ob = toMin(o.endTime);
    const next: [number, number][] = [];
    for (const [a, b] of parts) {
      if (ob <= a || oa >= b) {
        next.push([a, b]);
        continue;
      }
      if (oa > a) next.push([a, oa]);
      if (ob < b) next.push([ob, b]);
    }
    parts = next;
  }
  return parts.map(([a, b]) => ({ startTime: toHHMM(a), endTime: toHHMM(b) }));
}

/** Spans of one person that touch or overlap, joined: 10–11 + 11–12 = 10–12. */
export function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort(
    (x, y) => toMin(x.startTime) - toMin(y.startTime),
  );
  const out: [number, number][] = [];
  for (const s of sorted) {
    const a = toMin(s.startTime);
    const b = toMin(s.endTime);
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.map(([a, b]) => ({ startTime: toHHMM(a), endTime: toHHMM(b) }));
}

/** How many stand at each half-hour of the day. */
export function coverage(day: Span, people: Span[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const t of halfHours(day)) out.set(t, 0);
  for (const p of people) {
    for (const t of halfHours(p)) {
      if (out.has(t)) out.set(t, (out.get(t) ?? 0) + 1);
    }
  }
  return out;
}

/** The first half-hour at which adding `span` would exceed the capacity. */
export function overfull(
  day: Span,
  people: Span[],
  span: Span,
  max = CAPACITY_MAX,
): number | null {
  const c = coverage(day, people);
  for (const t of halfHours(span)) {
    if ((c.get(t) ?? 0) + 1 > max) return t;
  }
  return null;
}

/** Runs of half-hours where exactly one person stands, joined into spans. */
export function aloneSpans(day: Span, people: Span[]): Span[] {
  const c = coverage(day, people);
  const lone = [...c.entries()].filter(([, n]) => n === 1).map(([t]) => t);
  return merge(
    lone.map((t) => ({ startTime: toHHMM(t), endTime: toHHMM(t + STEP) })),
  );
}

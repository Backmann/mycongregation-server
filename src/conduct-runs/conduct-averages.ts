import type { ConductRunSegment } from '../entities/conduct-run.entity';
import type { ConductAverageValue } from '../entities/conduct-average.entity';

/**
 * WHAT A FINISHED MEETING TEACHES THE FORECAST (R-76, R-77; 22 November 2026).
 *
 * Four numbers per meeting, in seconds, each a plain mean of that meeting:
 *
 * - prayer: the closing song's segment minus the song's own recording — the
 *   prayer (and its «аминь»). Only the closing one: the opening segment
 *   starts when «Начать» is tapped, and on 18.11 and 22.11 that was after
 *   the song had begun (R-78), which would make the prayer look short.
 * - songLead: the middle song's segment minus its recording — the chairman's
 *   word before it and the walk back.
 * - walk: from the end of one part (its counsel included) to the start of the
 *   next — the brother coming up to the stage.
 * - counsel: the counsel after a student part.
 *
 * A number outside its range is a slip of a finger, not a habit: dropped.
 */
export const MEASURES = ['prayer', 'songLead', 'walk', 'counsel'] as const;
export type Measure = (typeof MEASURES)[number];

const RANGE: Record<Measure, [number, number]> = {
  prayer: [15, 300],
  songLead: [0, 180],
  walk: [1, 120],
  counsel: [10, 300],
};

/** How many meetings the forecast remembers. */
export const KEEP_MEETINGS = 12;

const CLOSING = new Set(['midweek_closing_prayer', 'weekend_closing_prayer']);
const MIDDLE = new Set(['mid_song', 'weekend_song']);

const inRange = (m: Measure, v: number) =>
  Number.isFinite(v) && v >= RANGE[m][0] && v <= RANGE[m][1];
const mean = (xs: number[]) =>
  xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

/**
 * The meeting's numbers. `songSec(segment)` is the recording's length of the
 * song in that segment, or null when it is not known.
 */
export function measuresOf(
  segments: ConductRunSegment[],
  songSec: (s: ConductRunSegment) => number | null,
): Partial<Record<Measure, number>> {
  const prayers: number[] = [];
  const leads: number[] = [];
  const walks: number[] = [];
  const counsels: number[] = [];
  let prevEnd: number | null = null;
  for (const s of segments) {
    if (CLOSING.has(s.key) || MIDDLE.has(s.key)) {
      const song = songSec(s);
      if (song !== null) {
        const rest = s.actualSec - song;
        if (CLOSING.has(s.key) && inRange('prayer', rest)) prayers.push(rest);
        if (MIDDLE.has(s.key) && inRange('songLead', rest)) leads.push(rest);
      }
    }
    if (typeof s.startSec === 'number' && prevEnd !== null) {
      const gap = s.startSec - prevEnd;
      if (inRange('walk', gap)) walks.push(gap);
    }
    if (typeof s.counselSec === 'number' && inRange('counsel', s.counselSec))
      counsels.push(s.counselSec);
    if (typeof s.startSec === 'number')
      prevEnd = s.startSec + s.actualSec + (s.counselSec ?? 0);
  }
  const out: Partial<Record<Measure, number>> = {};
  const put = (m: Measure, v: number | null) => {
    if (v !== null) out[m] = v;
  };
  put('prayer', mean(prayers));
  put('songLead', mean(leads));
  put('walk', mean(walks));
  put('counsel', mean(counsels));
  return out;
}

/** The week's number in, its old one out, the last KEEP_MEETINGS kept. */
export function withWeek(
  values: ConductAverageValue[],
  week: string,
  v: number | null,
): ConductAverageValue[] {
  const rest = values.filter((x) => x.week !== week);
  if (v !== null) rest.push({ week, v });
  return rest
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-KEEP_MEETINGS);
}

/** The middle one of the kept numbers — one odd meeting does not move it. */
export function median(values: ConductAverageValue[]): number | null {
  if (values.length === 0) return null;
  const xs = values.map((x) => x.v).sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

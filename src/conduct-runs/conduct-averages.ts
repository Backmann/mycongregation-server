import type { ConductRunSegment } from '../entities/conduct-run.entity';
import type { ConductAverageValue } from '../entities/conduct-average.entity';

/**
 * WHAT A FINISHED MEETING TEACHES THE FORECAST (R-76, R-77; 22 November 2026).
 *
 * Four numbers per meeting, in seconds, each the middle one of that meeting's:
 *
 * - prayer: the closing song's segment minus the song's own recording — the
 *   prayer (and its «аминь»); on the weekend the closing segment also holds
 *   the chairman's concluding words, so there it is words and prayer. Only
 *   the closing one: the opening segment starts when «Начать» is tapped, and
 *   on 18.11 and 22.11 that was after the song had begun (R-78), which would
 *   make the prayer look short. Not in the week of the circuit overseer's
 *   visit: he chooses the closing song, so the programme's song is not the
 *   one sung and its recording would be subtracted wrongly.
 * - songLead: the middle song's segment minus its recording — the chairman's
 *   word before it and the walk back.
 * - walk: from the end of one part (its counsel included) to the start of the
 *   next — the brother coming up to the stage. Under 3 s nobody walked (the
 *   same brother carrying on; seconds are rounded one by one in the app, so
 *   such a gap reads 0, 1 or 2); over 90 s it was a pause, not a walk. A
 *   shorter pause still reads as a walk: the meeting's middle walk, not its
 *   mean, keeps one such from moving it.
 * - counsel: the counsel after a student part.
 *
 * A number outside its range is a slip of a finger, not a habit: dropped.
 */
export const MEASURES = ['prayer', 'songLead', 'walk', 'counsel'] as const;
export type Measure = (typeof MEASURES)[number];

const RANGE: Record<Measure, [number, number]> = {
  prayer: [15, 300],
  songLead: [0, 180],
  walk: [3, 90],
  counsel: [10, 300],
};

/** How many meetings the forecast remembers. */
export const KEEP_MEETINGS = 12;

const CLOSING = new Set(['midweek_closing_prayer', 'weekend_closing_prayer']);
const MIDDLE = new Set(['mid_song', 'weekend_song']);

const inRange = (m: Measure, v: number) =>
  Number.isFinite(v) && v >= RANGE[m][0] && v <= RANGE[m][1];
/** Parts that tell the week of the circuit overseer's visit. */
const CO_WEEK = new Set(['co_service_talk', 'co_concluding_talk']);

const middleOf = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

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
  const coWeek = segments.some((s) => CO_WEEK.has(s.key));
  for (const s of segments) {
    if ((CLOSING.has(s.key) && !coWeek) || MIDDLE.has(s.key)) {
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
    // A part with no start leaves no end to measure the next walk from.
    prevEnd =
      typeof s.startSec === 'number'
        ? s.startSec + s.actualSec + (s.counselSec ?? 0)
        : null;
  }
  const out: Partial<Record<Measure, number>> = {};
  const put = (m: Measure, v: number | null) => {
    if (v !== null) out[m] = v;
  };
  put('prayer', middleOf(prayers));
  put('songLead', middleOf(leads));
  put('walk', middleOf(walks));
  put('counsel', middleOf(counsels));
  return out;
}

/**
 * The week's number in its place (or out), the last KEEP_MEETINGS kept, in the
 * order the meetings were saved. A result is saved or replaced only until the
 * meeting's day ends, so meetings arrive in their own order.
 */
export function withWeek(
  values: ConductAverageValue[],
  week: string,
  v: number | null,
): ConductAverageValue[] {
  const at = values.findIndex((x) => x.week === week);
  const out = [...values];
  if (at >= 0) {
    if (v === null) out.splice(at, 1);
    else out[at] = { week, v };
  } else if (v !== null) out.push({ week, v });
  return out.slice(-KEEP_MEETINGS);
}

/**
 * The week's number without its week (R-76, the reviewer's point of 23
 * November 2026): once the meeting's result is gone (its 4th day), nothing may
 * replace or take back the number, so the week is not needed — and with it a
 * prayer's seconds could be tied to the brother the programme names.
 */
export function sealWeek(
  values: ConductAverageValue[],
  week: string,
): ConductAverageValue[] {
  return values.map((x) => (x.week === week ? { v: x.v } : x));
}

/** The middle one of the kept numbers — one odd meeting does not move it. */
export function median(values: ConductAverageValue[]): number | null {
  return middleOf(values.map((x) => x.v));
}

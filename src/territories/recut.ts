import type { TerritoryGeometry } from '../entities/territory.entity';
import type { RecutMeasure } from '../entities/territory-recut.entity';
import { pointInside } from './geometry';
import { joinTwo, ReshapeError, splitByLine } from './reshape';

/**
 * The draft of re-cutting the territories, the parts that need no database
 * (15 November 2026).
 */

/**
 * The measure Lionel agreed to (15 November 2026): city walks up to 25 km,
 * parts of about 15; far out up to 30, parts of about 20 (the S-13 history:
 * a territory takes 167 days at the median, so 40 km far out meant a year);
 * under 5 km, a candidate to join a neighbour. «Far» begins at 13 minutes
 * by car from the nearest hall: on the server's road speeds our territories
 * fall into two groups with nothing between 12.0 and 14.4 minutes — the
 * same 22 far ones as the first count by hand, whose scale put the gap at
 * 11 (the live run of 15 November 2026).
 */
export const DEFAULT_MEASURE: RecutMeasure = {
  cityMaxKm: 25,
  cityTargetKm: 15,
  remoteMaxKm: 30,
  remoteTargetKm: 20,
  minKm: 5,
  remoteMinutes: 13,
};

/** A measure that holds together; the reason when it does not. */
export function measureProblem(m: RecutMeasure): string | null {
  const vals = Object.values(m);
  if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0))
    return 'every value is a positive number';
  if (m.cityTargetKm > m.cityMaxKm) return 'city: the part above the maximum';
  if (m.remoteTargetKm > m.remoteMaxKm)
    return 'far out: the part above the maximum';
  if (m.minKm >= m.cityTargetKm) return 'the minimum above the city part';
  if (m.cityMaxKm > 200 || m.remoteMaxKm > 200 || m.remoteMinutes > 120)
    return 'too large';
  return null;
}

/** At most this many parts in one cut: more is a new territory, not a cut. */
export const MAX_PARTS = 8;

/**
 * The middle of a drawn line, halfway along its length: the point that says
 * which part the line is meant to cut.
 */
export function middleOf(line: [number, number][]): [number, number] {
  let total = 0;
  for (let i = 1; i < line.length; i++)
    total += Math.hypot(
      line[i][0] - line[i - 1][0],
      line[i][1] - line[i - 1][1],
    );
  let left = total / 2;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const d = Math.hypot(bx - ax, by - ay);
    if (d >= left && d > 0) {
      const t = left / d;
      return [ax + t * (bx - ax), ay + t * (by - ay)];
    }
    left -= d;
  }
  return line[0];
}

/**
 * The parts a territory is cut into by the lines, one after another. Each
 * line cuts the part its middle lies in — not any part it would cross
 * when carried on: splitByLine carries a line's ends far out, so a line
 * drawn up to an earlier one («T») would otherwise cut its neighbour too.
 * Part 0 is what is left of the first piece; each cut puts its second piece
 * at the end, so the order follows the lines.
 */
export function partsOfCut(
  g: TerritoryGeometry,
  lines: [number, number][][],
): TerritoryGeometry[] {
  if (lines.length === 0 || lines.length + 1 > MAX_PARTS) {
    throw new ReshapeError('LINE_SHORT', `One to ${MAX_PARTS - 1} lines.`);
  }
  const parts: TerritoryGeometry[] = [g];
  for (const line of lines) {
    const i = line.length >= 2 ? partOf(middleOf(line), parts) : -1;
    if (i < 0) {
      throw new ReshapeError(
        'LINE_NOT_THROUGH',
        'A line must cross a part from edge to edge.',
      );
    }
    const pieces = splitByLine(parts[i], line);
    parts[i] = pieces[0];
    parts.push(pieces[1]);
  }
  return parts;
}

/**
 * Neighbours joined into one outline, in any order: each is joined to what
 * it touches; one left touching nothing is refused.
 */
export function joinAll(gs: TerritoryGeometry[]): TerritoryGeometry {
  if (gs.length < 2) {
    throw new ReshapeError('NOT_TOUCHING', 'Two territories at least.');
  }
  let whole = gs[0];
  const rest = gs.slice(1);
  while (rest.length > 0) {
    let joined = false;
    for (let i = 0; i < rest.length; i++) {
      try {
        whole = joinTwo(whole, rest[i]);
        rest.splice(i, 1);
        joined = true;
        break;
      } catch (e) {
        if (!(e instanceof ReshapeError && e.code === 'NOT_TOUCHING')) throw e;
      }
    }
    if (!joined) {
      throw new ReshapeError(
        'NOT_TOUCHING',
        'The territories do not all touch.',
      );
    }
  }
  return whole;
}

/** The part a point lies in; -1 when in none. */
export function partOf(
  p: [number, number],
  parts: TerritoryGeometry[],
): number {
  for (let i = 0; i < parts.length; i++) if (pointInside(p, parts[i])) return i;
  return -1;
}

/**
 * The share of homes (0…1) that a redrawn cut puts in another part than
 * before. A different number of parts is a different proposal: 1.
 */
export function movedShare(
  before: TerritoryGeometry[],
  after: TerritoryGeometry[],
  homes: [number, number][],
): number {
  if (before.length !== after.length) return 1;
  let counted = 0;
  let moved = 0;
  for (const h of homes) {
    const a = partOf(h, before);
    if (a < 0) continue;
    counted += 1;
    if (partOf(h, after) !== a) moved += 1;
  }
  return counted === 0 ? 0 : moved / counted;
}

/** Changed more than this share of homes: back to the committee. */
export const REOPEN_SHARE = 0.1;

/** City or far: the keepers' word first, else the minutes from the hall. */
export function classOf(
  minutes: number | null,
  word: 'city' | 'far' | undefined,
  m: RecutMeasure,
): 'city' | 'far' {
  if (word) return word;
  return minutes !== null && minutes > m.remoteMinutes ? 'far' : 'city';
}

export type RecutVerdict =
  | { action: 'cut'; parts: number; partKm: number }
  | { action: 'merge' }
  | { action: 'keep' };

/**
 * What the measure says of a territory: longer than its maximum — cut into
 * parts of about the target; shorter than the minimum — a candidate to
 * join; else as it is.
 */
export function verdictOf(
  walkKm: number,
  cls: 'city' | 'far',
  m: RecutMeasure,
): RecutVerdict {
  const max = cls === 'far' ? m.remoteMaxKm : m.cityMaxKm;
  const target = cls === 'far' ? m.remoteTargetKm : m.cityTargetKm;
  if (walkKm > max) {
    const parts = Math.min(MAX_PARTS, Math.ceil(walkKm / target));
    return { action: 'cut', parts, partKm: walkKm / parts };
  }
  if (walkKm < m.minKm) return { action: 'merge' };
  return { action: 'keep' };
}

/**
 * Small territories joined with neighbours (the draft's joins): from the
 * smallest up, each takes the smallest touching neighbour not yet taken,
 * while together they stay within the target and are below a full
 * territory's share of it. A small one with no such neighbour stays alone.
 */
export function joinGroups(
  items: { id: string; walkKm: number; small: boolean; target: number }[],
  touches: (a: string, b: string) => boolean,
): string[][] {
  const taken = new Set<string>();
  const groups: string[][] = [];
  const smalls = items
    .filter((x) => x.small)
    .sort((a, b) => a.walkKm - b.walkKm || a.id.localeCompare(b.id));
  for (const s of smalls) {
    if (taken.has(s.id)) continue;
    const group = [s.id];
    let sum = s.walkKm;
    for (;;) {
      if (sum >= s.target * 0.6) break;
      const near = items
        .filter(
          (x) =>
            !taken.has(x.id) &&
            !group.includes(x.id) &&
            sum + x.walkKm <= s.target &&
            group.some((g) => touches(g, x.id)),
        )
        .sort((a, b) => a.walkKm - b.walkKm || a.id.localeCompare(b.id));
      if (near.length === 0) break;
      group.push(near[0].id);
      sum += near[0].walkKm;
    }
    if (group.length > 1) {
      for (const g of group) taken.add(g);
      groups.push(group);
    }
  }
  return groups;
}

/** How fast the congregation works a territory through, by its S-13. */
export interface RecutPace {
  /** Walk worked per month (km), the middle of the territories done. */
  kmPerMonth: number;
  /** How many territories done it rests on. */
  samples: number;
}

/** Fewer done than this, and a pace would be a guess: none is given. */
export const PACE_SAMPLES = 8;

/**
 * The pace from the territories worked through (15 November 2026): for each
 * one done, its walk over the months it was out; the middle of them, so a
 * territory kept a year by mistake or done in a day does not pull it. Less
 * than two weeks counts as two weeks.
 */
export function paceOf(
  done: { walkKm: number; days: number }[],
): RecutPace | null {
  const rates = done
    .filter((d) => d.walkKm > 0 && d.days >= 0)
    .map((d) => d.walkKm / (Math.max(d.days, 14) / 30.44))
    .sort((a, b) => a - b);
  if (rates.length < PACE_SAMPLES) return null;
  const mid = rates.length / 2;
  const median =
    rates.length % 2
      ? rates[Math.floor(mid)]
      : (rates[mid - 1] + rates[mid]) / 2;
  return {
    kmPerMonth: Math.round(median * 10) / 10,
    samples: rates.length,
  };
}

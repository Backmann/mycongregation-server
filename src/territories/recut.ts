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
 * parts of about 15; far out — over 11 minutes' drive from the nearest hall
 * — up to 30, parts of about 20 (the S-13 history: a territory takes 167
 * days at the median, so 40 km far out meant a year); under 5 km, a
 * candidate to join a neighbour.
 */
export const DEFAULT_MEASURE: RecutMeasure = {
  cityMaxKm: 25,
  cityTargetKm: 15,
  remoteMaxKm: 30,
  remoteTargetKm: 20,
  minKm: 5,
  remoteMinutes: 11,
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

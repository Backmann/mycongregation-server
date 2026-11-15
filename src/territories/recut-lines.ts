import type { TerritoryGeometry } from '../entities/territory.entity';
import { boxOf, pointInside } from './geometry';
import { partOf } from './recut';
import { ReshapeError, splitByLine } from './reshape';

/**
 * Lines that cut a territory into parts of even homes (15 November 2026,
 * the draft of re-cutting): a first proposal for the territory servant to
 * look at and move — never applied by itself.
 *
 * Halving again and again: k parts are k1 = ⌊k/2⌋ and the rest, so each
 * line divides the homes of one part in the share k1 : k − k1. Among the
 * straight lines at 12 directions, at the share's place or near it, the one
 * through the widest stretch without homes wins (a field, a park, a railway,
 * the back of the gardens), as long as the smaller side stays within a
 * tenth of its share — 300 m of field weighs as much as a tenth off; a
 * line that would leave a part in two pieces is passed over.
 */

type Pt = [number, number];
const KY = 110_540;
/** Directions tried, in degrees. */
const ANGLES = Array.from({ length: 12 }, (_, i) => i * 15);
/** How far from the even share a line may sit, as a share of the smaller side. */
const SHARE_SLACK = 0.1;
/** A wider empty stretch than this (m) counts no more. */
const GAP_CAP_M = 300;
/** Past the outline, the drawn line goes on this far (m). */
const OVERHANG_M = 25;

export interface CutPlan {
  lines: Pt[][];
  /** Homes in each part, in the order partsOfCut makes them. */
  homes: number[];
}

/** The chord of a straight line across an outline: where it enters and leaves. */
function chord(
  g: TerritoryGeometry,
  origin: Pt,
  dir: Pt,
): [number, number] | null {
  const rings =
    g.type === 'Polygon'
      ? (g.coordinates as Pt[][])
      : (g.coordinates as Pt[][][]).flat();
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rings) {
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1];
      const b = r[i];
      // origin + t·dir = a + s·(b − a)
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const den = dir[0] * ey - dir[1] * ex;
      if (Math.abs(den) < 1e-15) continue;
      const ox = a[0] - origin[0];
      const oy = a[1] - origin[1];
      const t = (ox * ey - oy * ex) / den;
      const s = (ox * dir[1] - oy * dir[0]) / den;
      if (s < 0 || s > 1) continue;
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
  }
  return lo < hi ? [lo, hi] : null;
}

/**
 * The best line dividing the homes of one outline in the share a : b, or
 * null when no straight line does it in two whole pieces.
 */
export function bestLine(
  g: TerritoryGeometry,
  homes: Pt[],
  a: number,
  b: number,
): { line: Pt[]; pieces: [TerritoryGeometry, TerritoryGeometry] } | null {
  if (homes.length < 2) return null;
  const [x0, y0, x1, y1] = boxOf(g);
  const lat = (y0 + y1) / 2;
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const share = a / (a + b);
  let best: {
    score: number;
    line: Pt[];
    pieces: [TerritoryGeometry, TerritoryGeometry];
  } | null = null;
  for (const deg of ANGLES) {
    const r = (deg * Math.PI) / 180;
    // In metres: along the line u, across it n.
    const u: Pt = [Math.cos(r), Math.sin(r)];
    const n: Pt = [-u[1], u[0]];
    const across = homes
      .map((h) => (h[0] - x0) * kx * n[0] + (h[1] - y0) * KY * n[1])
      .sort((p, q) => p - q);
    const N = across.length;
    const want = share * N;
    const side = Math.min(want, N - want);
    const lo = Math.max(1, Math.floor(want - SHARE_SLACK * side));
    const hi = Math.min(N - 1, Math.ceil(want + SHARE_SLACK * side));
    for (let i = lo; i <= hi; i++) {
      const gap = across[i] - across[i - 1];
      if (gap <= 0) continue;
      const off = (across[i] + across[i - 1]) / 2;
      const miss = Math.abs(i - want) / side;
      if (miss > SHARE_SLACK) continue;
      const score = (miss / SHARE_SLACK) * GAP_CAP_M - Math.min(gap, GAP_CAP_M);
      if (best && score >= best.score) continue;
      // The line: across = off, in degrees again.
      const originM: Pt = [n[0] * off, n[1] * off];
      const origin: Pt = [x0 + originM[0] / kx, y0 + originM[1] / KY];
      const dir: Pt = [u[0] / kx, u[1] / KY];
      const c = chord(g, origin, dir);
      if (!c) continue;
      const over = OVERHANG_M;
      const t0 = c[0] - over;
      const t1 = c[1] + over;
      const line: Pt[] = [
        [origin[0] + dir[0] * t0, origin[1] + dir[1] * t0],
        [origin[0] + dir[0] * t1, origin[1] + dir[1] * t1],
      ];
      const mid: Pt = [
        origin[0] + (dir[0] * (c[0] + c[1])) / 2,
        origin[1] + (dir[1] * (c[0] + c[1])) / 2,
      ];
      if (!pointInside(mid, g)) continue;
      let pieces: [TerritoryGeometry, TerritoryGeometry];
      try {
        pieces = splitByLine(g, line);
      } catch (e) {
        if (e instanceof ReshapeError) continue;
        throw e;
      }
      best = { score, line, pieces };
    }
  }
  return best ? { line: best.line, pieces: best.pieces } : null;
}

/**
 * Lines that cut an outline into `k` parts of about even homes, in the
 * order partsOfCut reads them (each line's middle in the part it cuts).
 * Null when some part cannot be cut by a straight line: then the territory
 * servant draws it himself.
 */
export function cutPlan(
  g: TerritoryGeometry,
  homes: Pt[],
  k: number,
): CutPlan | null {
  const lines: Pt[][] = [];
  const parts: { g: TerritoryGeometry; k: number }[] = [{ g, k }];
  // Halve the part with the most parts still to make, until each is one.
  for (;;) {
    const i = parts.findIndex((p) => p.k > 1);
    if (i < 0) break;
    const p = parts[i];
    const inside = homes.filter((h) => pointInside(h, p.g));
    const k1 = Math.floor(p.k / 2);
    const cut = bestLine(p.g, inside, k1, p.k - k1);
    if (!cut) return null;
    // Which piece takes k1 parts: the one with fewer homes.
    const n0 = inside.filter((h) => pointInside(h, cut.pieces[0])).length;
    const n1 = inside.length - n0;
    const [ka, kb] = n0 <= n1 ? [k1, p.k - k1] : [p.k - k1, k1];
    lines.push(cut.line);
    parts[i] = { g: cut.pieces[0], k: ka };
    parts.push({ g: cut.pieces[1], k: kb });
  }
  const gs = parts.map((p) => p.g);
  const counts = gs.map(() => 0);
  for (const h of homes) {
    const j = partOf(h, gs);
    if (j >= 0) counts[j] += 1;
  }
  return { lines, homes: counts };
}

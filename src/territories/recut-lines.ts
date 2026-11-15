import type { TerritoryGeometry } from '../entities/territory.entity';
import { boxOf, pointInside } from './geometry';
import { partOf } from './recut';
import { ReshapeError, splitByLine } from './reshape';

/**
 * Lines that cut a territory into parts of an even walk (15 November 2026,
 * the draft of re-cutting): a first proposal for the territory servant to
 * look at and move — never applied by itself.
 *
 * Even by the walk, not by the homes: a farm far from the next weighs as
 * much as a street of houses (the first try cut a village in two and left
 * all its farms in one part). Each home weighs a doorstep plus the way to
 * its nearest neighbour, up to a cap; the weights add up to about the walk.
 *
 * Halving again and again: k parts are k1 = ⌊k/2⌋ and the rest, so each
 * line divides the weight of one part in the share k1 : k − k1. Of the
 * straight lines at 18 directions whose smaller side stays within a tenth
 * of its share, the one with the fewest homes beside it (within 25 m: a
 * line beside homes cuts their street) wins — through a field, a park, a
 * railway; a tenth off the share weighs as much as 30 homes beside the
 * line. A line that would leave a part in two pieces is passed over.
 */

type Pt = [number, number];
const KY = 110_540;
/** Directions tried, in degrees. */
const ANGLES = Array.from({ length: 18 }, (_, i) => i * 10);
/** How far from the even share a line may sit, as a share of the smaller side. */
const SHARE_SLACK = 0.1;
/** Homes this close to a line (m) are «beside» it: their street is cut. */
const BESIDE_M = 25;
/** A tenth off the share weighs as much as this many homes beside the line. */
const SLACK_HOMES = 30;
/** A home's weight: a doorstep plus the way to its neighbour, up to a cap (m). */
const DOOR_M = 15;
const WAY_CAP_M = 250;
/** Past the outline, the drawn line goes on this far (m). */
const OVERHANG_M = 25;

/** A home and the metres of walk it stands for. */
export interface Weighted {
  p: Pt;
  w: number;
}

/** Each home weighed by the way to its nearest neighbour. */
export function weighHomes(homes: Pt[]): Weighted[] {
  if (homes.length === 0) return [];
  const lat = homes[0][1];
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const CELL = 60;
  const cells = new Map<string, number[]>();
  const key = (x: number, y: number) => `${x}:${y}`;
  homes.forEach((h, i) => {
    const k = key(
      Math.floor((h[0] * kx) / CELL),
      Math.floor((h[1] * KY) / CELL),
    );
    const l = cells.get(k);
    if (l) l.push(i);
    else cells.set(k, [i]);
  });
  return homes.map((h, i) => {
    const cx = Math.floor((h[0] * kx) / CELL);
    const cy = Math.floor((h[1] * KY) / CELL);
    let best = WAY_CAP_M;
    const r = Math.ceil(WAY_CAP_M / CELL);
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (const j of cells.get(key(cx + dx, cy + dy)) ?? []) {
          if (j === i) continue;
          const d = Math.hypot(
            (homes[j][0] - h[0]) * kx,
            (homes[j][1] - h[1]) * KY,
          );
          if (d < best) best = d;
        }
    return { p: h, w: DOOR_M + best };
  });
}

export interface CutPlan {
  lines: Pt[][];
  /** Homes in each part, in the order partsOfCut makes them. */
  homes: number[];
  /** The walk each part stands for, by the weights (m). */
  walkM: number[];
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
 * The best line dividing the weight of one outline's homes in the share
 * a : b, or null when no straight line does it in two whole pieces.
 */
export function bestLine(
  g: TerritoryGeometry,
  homes: Weighted[],
  a: number,
  b: number,
): { line: Pt[]; pieces: [TerritoryGeometry, TerritoryGeometry] } | null {
  if (homes.length < 2) return null;
  const [x0, y0, x1, y1] = boxOf(g);
  const lat = (y0 + y1) / 2;
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const share = a / (a + b);
  const total = homes.reduce((n, h) => n + h.w, 0);
  const want = share * total;
  const side = Math.min(want, total - want);
  type Cand = { cost: number; off: number; u: Pt; n: Pt };
  const cands: Cand[] = [];
  for (const deg of ANGLES) {
    const r = (deg * Math.PI) / 180;
    // In metres: along the line u, across it n.
    const u: Pt = [Math.cos(r), Math.sin(r)];
    const n: Pt = [-u[1], u[0]];
    const across = homes
      .map((h) => ({
        v: (h.p[0] - x0) * kx * n[0] + (h.p[1] - y0) * KY * n[1],
        w: h.w,
      }))
      .sort((p, q) => p.v - q.v);
    const vs = across.map((x) => x.v);
    let cum = 0;
    let lo = 0;
    let hi = 0;
    for (let i = 1; i < across.length; i++) {
      cum += across[i - 1].w;
      const gap = across[i].v - across[i - 1].v;
      if (gap <= 0) continue;
      const miss = Math.abs(cum - want) / side;
      if (miss > SHARE_SLACK) continue;
      const off = (across[i].v + across[i - 1].v) / 2;
      // Homes within BESIDE_M of the line: a window on the sorted values.
      while (lo < vs.length && vs[lo] < off - BESIDE_M) lo++;
      if (hi < lo) hi = lo;
      while (hi < vs.length && vs[hi] <= off + BESIDE_M) hi++;
      const beside = hi - lo;
      cands.push({
        cost: (miss / SHARE_SLACK) * SLACK_HOMES + beside,
        off,
        u,
        n,
      });
    }
  }
  cands.sort((p, q) => p.cost - q.cost);
  for (const c of cands) {
    const originM: Pt = [c.n[0] * c.off, c.n[1] * c.off];
    const origin: Pt = [x0 + originM[0] / kx, y0 + originM[1] / KY];
    const dir: Pt = [c.u[0] / kx, c.u[1] / KY];
    const ch = chord(g, origin, dir);
    if (!ch) continue;
    const t0 = ch[0] - OVERHANG_M;
    const t1 = ch[1] + OVERHANG_M;
    const line: Pt[] = [
      [origin[0] + dir[0] * t0, origin[1] + dir[1] * t0],
      [origin[0] + dir[0] * t1, origin[1] + dir[1] * t1],
    ];
    const mid: Pt = [
      origin[0] + (dir[0] * (ch[0] + ch[1])) / 2,
      origin[1] + (dir[1] * (ch[0] + ch[1])) / 2,
    ];
    if (!pointInside(mid, g)) continue;
    try {
      return { line, pieces: splitByLine(g, line) };
    } catch (e) {
      if (e instanceof ReshapeError) continue;
      throw e;
    }
  }
  return null;
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
  const weighed = weighHomes(homes);
  // Halve the part with the most parts still to make, until each is one.
  for (;;) {
    const i = parts.findIndex((p) => p.k > 1);
    if (i < 0) break;
    const p = parts[i];
    const inside = weighed.filter((h) => pointInside(h.p, p.g));
    const k1 = Math.floor(p.k / 2);
    const cut = bestLine(p.g, inside, k1, p.k - k1);
    if (!cut) return null;
    // Which piece takes k1 parts: the one with less walk.
    const w0 = inside
      .filter((h) => pointInside(h.p, cut.pieces[0]))
      .reduce((n, h) => n + h.w, 0);
    const w1 = inside.reduce((n, h) => n + h.w, 0) - w0;
    const [n0, n1] = [w0, w1];
    const [ka, kb] = n0 <= n1 ? [k1, p.k - k1] : [p.k - k1, k1];
    lines.push(cut.line);
    parts[i] = { g: cut.pieces[0], k: ka };
    parts.push({ g: cut.pieces[1], k: kb });
  }
  const gs = parts.map((p) => p.g);
  const counts = gs.map(() => 0);
  const walk = gs.map(() => 0);
  for (const h of weighed) {
    const j = partOf(h.p, gs);
    if (j < 0) continue;
    counts[j] += 1;
    walk[j] += h.w;
  }
  return { lines, homes: counts, walkM: walk.map(Math.round) };
}

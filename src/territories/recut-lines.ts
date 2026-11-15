import type { TerritoryGeometry } from '../entities/territory.entity';
import { boxOf, pointInside } from './geometry';
import { middleOf, partOf } from './recut';
import type { Graph } from './way';
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
/** A line along the streets keeps within this of its straight line (m)… */
const CORRIDOR_M = 300;
/**
 * …and may miss the share by more than a straight one: a street with a
 * quarter off the share (75 «homes» of cost) beats a straight line beside
 * a hundred homes (16 November 2026, Rhynern: a diagonal through the blocks
 * had won because no street kept within 15%).
 */
const STREET_SLACK = 0.25;
/** Straight candidates tried along the streets. */
const STREET_TRIES = 30;

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
  roads?: Graph,
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
  const straight: {
    cost: number;
    line: Pt[];
    ends: [Pt, Pt];
    dir: Pt;
    pieces: [TerritoryGeometry, TerritoryGeometry];
  }[] = [];
  const seen = new Set<string>();
  for (const c of cands) {
    const originM: Pt = [c.n[0] * c.off, c.n[1] * c.off];
    const origin: Pt = [x0 + originM[0] / kx, y0 + originM[1] / KY];
    const dir: Pt = [c.u[0] / kx, c.u[1] / KY];
    const ch = chord(g, origin, dir);
    if (!ch) continue;
    const at = (t: number): Pt => [
      origin[0] + dir[0] * t,
      origin[1] + dir[1] * t,
    ];
    const line: Pt[] = [at(ch[0] - OVERHANG_M), at(ch[1] + OVERHANG_M)];
    if (!pointInside(at((ch[0] + ch[1]) / 2), g)) continue;
    let pieces: [TerritoryGeometry, TerritoryGeometry];
    try {
      pieces = splitByLine(g, line);
    } catch (e) {
      if (e instanceof ReshapeError) continue;
      throw e;
    }
    if (!roads) return { line, pieces };
    // Near twins (the next offset at the same direction) add nothing.
    const key = `${Math.round(Math.atan2(c.u[1], c.u[0]) * 10)}:${Math.round(c.off / 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    straight.push({
      cost: c.cost,
      line,
      ends: [at(ch[0]), at(ch[1])],
      dir,
      pieces,
    });
    if (straight.length >= STREET_TRIES) break;
  }
  if (!roads || straight.length === 0) return null;
  // Along the streets: of the best straight lines, each laid on the roads
  // between where it enters and leaves; the one that keeps the share and
  // crosses the fewest homes off the road wins. None: the best straight one.
  let best: {
    cost: number;
    line: Pt[];
    pieces: [TerritoryGeometry, TerritoryGeometry];
  } | null = null;
  for (const s of straight) {
    const laid = alongRoads(g, s.ends, s.dir, roads, kx);
    if (!laid) continue;
    let pieces: [TerritoryGeometry, TerritoryGeometry];
    try {
      pieces = splitByLine(g, laid.line);
    } catch (e) {
      if (e instanceof ReshapeError) continue;
      throw e;
    }
    if (!pointInside(middleOf(laid.line), g)) continue;
    const w0 = homes
      .filter((h) => pointInside(h.p, pieces[0]))
      .reduce((n, h) => n + h.w, 0);
    // Which piece is the a-share is not known here: the nearer of the two.
    const miss =
      Math.min(Math.abs(w0 - want), Math.abs(total - w0 - want)) / side;
    if (miss > STREET_SLACK) continue;
    const beside = homes.filter((h) =>
      laid.offRoad.some(([p, q]) => metresToSegment(h.p, p, q, kx) < BESIDE_M),
    ).length;
    const cost = (miss / SHARE_SLACK) * SLACK_HOMES + beside;
    if (!best || cost < best.cost) best = { cost, line: laid.line, pieces };
  }
  // A straight line competes at the same price: the share missed and every
  // home beside it.
  const first = straight[0];
  if (best && best.cost <= first.cost)
    return { line: best.line, pieces: best.pieces };
  return { line: first.line, pieces: first.pieces };
}

/** Metres from p to the segment a–b. */
function metresToSegment(p: Pt, a: Pt, b: Pt, kx: number): number {
  const ax = (a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * KY;
  const bx = (b[0] - p[0]) * kx;
  const by = (b[1] - p[1]) * KY;
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t =
    len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * A straight cut laid on the roads: from where it enters the outline to the
 * nearest road point inside, along the roads (within CORRIDOR_M of the
 * straight line, inside the outline) to the road point nearest where it
 * leaves, and out. The two short links off the road are returned too: the
 * homes beside them are the ones the cut really splits from their street.
 */
export function alongRoads(
  g: TerritoryGeometry,
  ends: [Pt, Pt],
  dir: Pt,
  roads: Graph,
  kx: number,
): { line: Pt[]; offRoad: [Pt, Pt][] } | null {
  const [e0, e1] = ends;
  const inCorridor = new Set<number>();
  const [bx0, by0, bx1, by1] = boxOf(g);
  roads.pts.forEach((p, i) => {
    if (p[0] < bx0 || p[0] > bx1 || p[1] < by0 || p[1] > by1) return;
    if (metresToSegment(p, e0, e1, kx) > CORRIDOR_M) return;
    if (pointInside(p, g)) inCorridor.add(i);
  });
  if (inCorridor.size < 2) return null;
  const nearest = (q: Pt): number | null => {
    let best: number | null = null;
    let bestM = CORRIDOR_M;
    for (const i of inCorridor) {
      const p = roads.pts[i];
      const m = Math.hypot((p[0] - q[0]) * kx, (p[1] - q[1]) * KY);
      if (m < bestM) {
        bestM = m;
        best = i;
      }
    }
    return best;
  };
  const from = nearest(e0);
  const to = nearest(e1);
  if (from === null || to === null || from === to) return null;
  // Dijkstra inside the corridor, with a binary heap.
  const dist = new Map<number, number>([[from, 0]]);
  const back = new Map<number, number>();
  const heap: [number, number][] = [[0, from]];
  const push = (x: [number, number]) => {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (d > (dist.get(u) ?? Infinity)) continue;
    if (u === to) break;
    for (const e of roads.next[u]) {
      if (!inCorridor.has(e.to)) continue;
      const nd = d + e.m;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        back.set(e.to, u);
        push([nd, e.to]);
      }
    }
  }
  if (!dist.has(to)) return null;
  const path: Pt[] = [];
  for (let v: number | undefined = to; v !== undefined; v = back.get(v)) {
    path.push(roads.pts[v]);
    if (v === from) break;
  }
  path.reverse();
  const len = Math.hypot(dir[0] * kx, dir[1] * KY) || 1;
  const out = (p: Pt, sign: number): Pt => [
    p[0] + (sign * dir[0] * OVERHANG_M) / len,
    p[1] + (sign * dir[1] * OVERHANG_M) / len,
  ];
  const thinned = thinLine(path, kx);
  return {
    line: [out(e0, -1), e0, ...thinned, e1, out(e1, 1)],
    offRoad: [
      [e0, thinned[0]],
      [thinned[thinned.length - 1], e1],
    ],
  };
}

/** Douglas–Peucker to within 4 m, and never more than 400 points. */
function thinLine(line: Pt[], kx: number): Pt[] {
  if (line.length <= 2) return line;
  const keep = new Array<boolean>(line.length).fill(false);
  keep[0] = keep[line.length - 1] = true;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let farM = 4;
    for (let i = a + 1; i < b; i++) {
      const m = metresToSegment(line[i], line[a], line[b], kx);
      if (m > farM) {
        farM = m;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  const out = line.filter((_, i) => keep[i]);
  if (out.length <= 400) return out;
  const step = Math.ceil(out.length / 400);
  return out.filter((_, i) => i % step === 0 || i === out.length - 1);
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
  roads?: Graph,
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
    const cut = bestLine(p.g, inside, k1, p.k - k1, roads);
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

import type { TerritoryGeometry } from '../entities/territory.entity';
import { boxOf, pointInside } from './geometry';

/**
 * Minutes by car from the halls (15 November 2026, the draft of
 * re-cutting): «far» is where one drives to and spends an hour and a half
 * or two. Worked out on the congregation's own named streets — no service
 * outside: a graph of the roads with a speed by kind of road, without
 * traffic. On our map the territories fall into two groups with nothing
 * between 10.5 and 11.9 minutes, so the exact speeds hardly matter; what
 * matters is that the order is right.
 */

export type Pt = [number, number];

/** km/h by the map's kind of road; paths are not driven. */
export const SPEED_KMH: Record<string, number> = {
  highway: 100,
  major_road: 50,
  minor_road: 30,
  other: 25,
};
const NOT_DRIVEN = new Set(['path', 'rail', 'ferry', 'aeroway']);
/** Lines are cut in steps of this length… */
const STEP_M = 50;
/** …points of two roads this close are a crossing… */
const JOIN_M = 15;
/** …and a dead end this close to another road is joined to it (a crossing thinned away). */
const END_M = 30;
const CELL_M = 60;

export interface DriveGraph {
  pts: Pt[];
  /** Neighbours with minutes. */
  next: { to: number; min: number }[][];
  cells: Map<string, number[]>;
  kx: number;
}

const KY = 110_540;

/** The drivable roads as a graph. */
export function driveGraph(
  roads: { kind: string; lines: Pt[][] }[],
): DriveGraph {
  const pts: Pt[] = [];
  const next: { to: number; min: number }[][] = [];
  const lineOf: number[] = [];
  const first = roads.find((r) => r.lines[0]?.[0])?.lines[0][0];
  const kx =
    111_320 * Math.cos((((first?.[1] ?? 51) as number) * Math.PI) / 180);
  const metres = (a: Pt, b: Pt) =>
    Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * KY);
  const add = (p: Pt, li: number) => {
    pts.push(p);
    next.push([]);
    lineOf.push(li);
    return pts.length - 1;
  };
  const link = (a: number, b: number, kmh: number) => {
    if (a === b) return;
    const min = (metres(pts[a], pts[b]) / 1000 / kmh) * 60;
    next[a].push({ to: b, min });
    next[b].push({ to: a, min });
  };
  let li = 0;
  for (const r of roads) {
    if (NOT_DRIVEN.has(r.kind)) continue;
    const kmh = SPEED_KMH[r.kind] ?? SPEED_KMH.other;
    for (const raw of r.lines) {
      li += 1;
      let prev = -1;
      for (let j = 0; j < raw.length; j++) {
        if (j === 0) {
          prev = add(raw[0], li);
          continue;
        }
        const a = raw[j - 1];
        const b = raw[j];
        const steps = Math.max(1, Math.ceil(metres(a, b) / STEP_M));
        for (let q = 1; q <= steps; q++) {
          const i = add(
            [
              a[0] + ((b[0] - a[0]) * q) / steps,
              a[1] + ((b[1] - a[1]) * q) / steps,
            ],
            li,
          );
          link(prev, i, kmh);
          prev = i;
        }
      }
    }
  }
  const cellKey = (p: Pt) =>
    `${Math.floor((p[0] * kx) / CELL_M)}:${Math.floor((p[1] * KY) / CELL_M)}`;
  const cells = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const key = cellKey(p);
    const list = cells.get(key);
    if (list) list.push(i);
    else cells.set(key, [i]);
  });
  const around = (p: Pt, within: number): number[] => {
    const cx = Math.floor((p[0] * kx) / CELL_M);
    const cy = Math.floor((p[1] * KY) / CELL_M);
    const r = Math.ceil(within / CELL_M);
    const out: number[] = [];
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (const j of cells.get(`${cx + dx}:${cy + dy}`) ?? []) out.push(j);
    return out;
  };
  // Crossings: points of different roads close together, slowly.
  pts.forEach((p, i) => {
    for (const j of around(p, JOIN_M)) {
      if (j <= i || lineOf[j] === lineOf[i]) continue;
      if (metres(p, pts[j]) <= JOIN_M) link(i, j, SPEED_KMH.minor_road);
    }
  });
  // Dead ends: the end of a road beside another road meets it — at the
  // nearest point of that road's line, not of its samples, which stand
  // STEP_M apart.
  const degree = next.map((x) => x.length);
  pts.forEach((p, i) => {
    if (degree[i] !== 1) return;
    let best: { a: number; b: number; m: number; t: number } | null = null;
    for (const j of around(p, END_M + STEP_M)) {
      if (lineOf[j] === lineOf[i]) continue;
      for (const e of next[j]) {
        const k = e.to;
        if (k < j || lineOf[k] !== lineOf[j]) continue;
        const ax = (pts[j][0] - p[0]) * kx;
        const ay = (pts[j][1] - p[1]) * KY;
        const bx = (pts[k][0] - p[0]) * kx;
        const by = (pts[k][1] - p[1]) * KY;
        const dx = bx - ax;
        const dy = by - ay;
        const len = dx * dx + dy * dy;
        const t =
          len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
        const m = Math.hypot(ax + t * dx, ay + t * dy);
        if (m <= END_M && (!best || m < best.m)) best = { a: j, b: k, m, t };
      }
    }
    if (!best) return;
    const at = add(
      [
        pts[best.a][0] + (pts[best.b][0] - pts[best.a][0]) * best.t,
        pts[best.a][1] + (pts[best.b][1] - pts[best.a][1]) * best.t,
      ],
      lineOf[best.a],
    );
    const kmh = SPEED_KMH.minor_road;
    link(at, best.a, kmh);
    link(at, best.b, kmh);
    link(i, at, kmh);
  });
  return { pts, next, cells, kx };
}

/** The point of the graph nearest to p within `within` metres. */
export function nearestOf(g: DriveGraph, p: Pt, within = 500): number | null {
  const cx = Math.floor((p[0] * g.kx) / CELL_M);
  const cy = Math.floor((p[1] * KY) / CELL_M);
  const r = Math.ceil(within / CELL_M);
  let best: number | null = null;
  let bestM = within;
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++)
      for (const j of g.cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
        const q = g.pts[j];
        const m = Math.hypot((q[0] - p[0]) * g.kx, (q[1] - p[1]) * KY);
        if (m < bestM) {
          bestM = m;
          best = j;
        }
      }
  return best;
}

/** Minutes from one point to every point of the graph (Dijkstra). */
export function minutesFrom(g: DriveGraph, from: number): Float64Array {
  const n = g.pts.length;
  const t = new Float64Array(n).fill(Infinity);
  t[from] = 0;
  // A binary heap of [minutes, point].
  const heap: [number, number][] = [[0, from]];
  const push = (x: [number, number]) => {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
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
    if (d > t[u]) continue;
    for (const e of g.next[u]) {
      const nd = d + e.min;
      if (nd < t[e.to]) {
        t[e.to] = nd;
        push([nd, e.to]);
      }
    }
  }
  return t;
}

/**
 * Minutes into a territory: the middle (median) of the minutes to the
 * road points inside it — not its nearest corner, which a long strip
 * reaches early. Null when no road inside is reached.
 */
export function minutesInto(
  g: DriveGraph,
  minutes: Float64Array,
  geometry: TerritoryGeometry,
): number | null {
  const [x0, y0, x1, y1] = boxOf(geometry);
  const inside: number[] = [];
  g.pts.forEach((p, i) => {
    if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) return;
    if (Number.isFinite(minutes[i]) && pointInside(p, geometry))
      inside.push(minutes[i]);
  });
  if (inside.length === 0) return null;
  inside.sort((a, b) => a - b);
  return inside[inside.length >> 1];
}

import { dist, type Pt } from './split';

/**
 * The way through a part (14 November 2026, «путь по дорогам»): the roads
 * of the map as a graph, and through it the order of a part's streets and
 * the stretches of road from one street to the next, so a pair can follow
 * one line from the start to the last house.
 *
 * The map's lines come cut at tile edges and simplified: a crossing need
 * not share a point. So the lines are cut in steps of STEP_M and points of
 * different lines closer than JOIN_M are joined.
 */

/** Lines are cut in steps of this length… */
export const STEP_M = 20;
/** …and points of two lines this close are one crossing. */
export const JOIN_M = 12;
/** A street end further than this from every road: walked to straight. */
export const OFF_ROAD_M = 80;

export interface Graph {
  pts: Pt[];
  /** Neighbours of each point, with the metres to them. */
  next: { to: number; m: number }[][];
}

/** The roads as a graph. */
export function graphOf(lines: Pt[][]): Graph {
  const pts: Pt[] = [];
  const next: { to: number; m: number }[][] = [];
  const add = (p: Pt) => {
    pts.push(p);
    next.push([]);
    return pts.length - 1;
  };
  const link = (a: number, b: number) => {
    if (a === b) return;
    const m = dist(pts[a], pts[b]);
    next[a].push({ to: b, m });
    next[b].push({ to: a, m });
  };
  const lineOf: number[] = [];
  lines.forEach((raw, li) => {
    let prev = -1;
    for (let j = 0; j < raw.length; j++) {
      const a = raw[j - 1];
      const b = raw[j];
      if (j === 0) {
        prev = add(b);
        lineOf[prev] = li;
        continue;
      }
      const steps = Math.max(1, Math.ceil(dist(a, b) / STEP_M));
      for (let q = 1; q <= steps; q++) {
        const i = add([
          a[0] + ((b[0] - a[0]) * q) / steps,
          a[1] + ((b[1] - a[1]) * q) / steps,
        ]);
        lineOf[i] = li;
        link(prev, i);
        prev = i;
      }
    }
  });
  // Crossings: points of different lines close together, found by a grid.
  if (pts.length) {
    const k = 111_320 * Math.cos((pts[0][1] * Math.PI) / 180);
    const cell = (p: Pt) => [
      Math.floor((p[0] * k) / JOIN_M),
      Math.floor((p[1] * 110_540) / JOIN_M),
    ];
    const grid = new Map<string, number[]>();
    pts.forEach((p, i) => {
      const [x, y] = cell(p);
      const key = `${x}:${y}`;
      grid.set(key, [...(grid.get(key) ?? []), i]);
    });
    pts.forEach((p, i) => {
      const [x, y] = cell(p);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const j of grid.get(`${x + dx}:${y + dy}`) ?? []) {
            if (j <= i || lineOf[j] === lineOf[i]) continue;
            if (dist(p, pts[j]) <= JOIN_M) link(i, j);
          }
    });
  }
  return { pts, next };
}

/** The point of the graph nearest to p, and how far. */
export function nearestPoint(g: Graph, p: Pt): { i: number; m: number } | null {
  let best: { i: number; m: number } | null = null;
  g.pts.forEach((q, i) => {
    const m = dist(p, q);
    if (!best || m < best.m) best = { i, m };
  });
  return best;
}

/** Shortest distances from one point to all (Dijkstra), with the way back. */
function fromPoint(g: Graph, a: number): { m: Float64Array; back: Int32Array } {
  const m = new Float64Array(g.pts.length).fill(Infinity);
  const back = new Int32Array(g.pts.length).fill(-1);
  m[a] = 0;
  // A small binary heap of [metres, point].
  const heap: [number, number][] = [[0, a]];
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
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]];
        i = s;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, i] = pop();
    if (d > m[i]) continue;
    for (const e of g.next[i]) {
      const nd = d + e.m;
      if (nd < m[e.to]) {
        m[e.to] = nd;
        back[e.to] = i;
        push([nd, e.to]);
      }
    }
  }
  return { m, back };
}

/** The two ends of a street as drawn: its points furthest apart. */
export function endsOf(lines: Pt[][]): [Pt, Pt] | null {
  const all = lines.flat();
  if (all.length === 0) return null;
  let best: [Pt, Pt] = [all[0], all[0]];
  let bm = -1;
  // A street has few points: every pair is cheap.
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const m = dist(all[i], all[j]);
      if (m > bm) {
        bm = m;
        best = [all[i], all[j]];
      }
    }
  return best;
}

export interface WayStreet {
  key: string;
  lines: Pt[][];
}

export interface Way<T> {
  /** The streets in the order to walk them. */
  streets: T[];
  /** From the start to the first street, then from each to the next: along the roads. */
  links: Pt[][];
  /** Metres of road between streets, and how many links had no road (straight). */
  linkM: number;
  straight: number;
}

/**
 * The order to walk a part's streets and the roads between them: from the
 * start, each time the street nearest along the roads, entered at its
 * nearer end and left at the other. A street end off every road is reached
 * in a straight line.
 */
export function wayThrough<T extends WayStreet>(
  roads: Pt[][] | Graph,
  streets: T[],
  start: Pt | null,
): Way<T> {
  const g = Array.isArray(roads) ? graphOf(roads) : roads;
  const ends = new Map<string, [Pt, Pt]>();
  for (const s of streets) {
    const e = endsOf(s.lines);
    if (e) ends.set(s.key, e);
  }
  const snapped = new Map<string, number>();
  const snap = (p: Pt) => {
    const key = `${p[0]},${p[1]}`;
    const had = snapped.get(key);
    if (had !== undefined) return had;
    const n = nearestPoint(g, p);
    const i = n && n.m <= OFF_ROAD_M ? n.i : -1;
    snapped.set(key, i);
    return i;
  };
  const left = streets.filter((s) => ends.has(s.key));
  const out: T[] = [];
  const links: Pt[][] = [];
  let linkM = 0;
  let straight = 0;
  let here: Pt | null = start ?? (left[0] ? ends.get(left[0].key)![0] : null);
  while (left.length && here) {
    const from = snap(here);
    const tree = from >= 0 ? fromPoint(g, from) : null;
    // The road metres to a point, or the straight metres when off the roads.
    const toward = (p: Pt) => {
      const i = snap(p);
      if (!tree || i < 0 || !Number.isFinite(tree.m[i]))
        return { m: dist(here!, p) * 1.4, i: -1 };
      return { m: tree.m[i], i };
    };
    let best: { k: number; m: number; enter: Pt; leave: Pt; i: number } | null =
      null;
    left.forEach((s, k) => {
      const [a, b] = ends.get(s.key)!;
      for (const [enter, leave] of [
        [a, b],
        [b, a],
      ] as [Pt, Pt][]) {
        const w = toward(enter);
        if (!best || w.m < best.m) best = { k, m: w.m, enter, leave, i: w.i };
      }
    });
    const chosen = best!;
    const s = left.splice(chosen.k, 1)[0];
    out.push(s);
    // The link: the road from here to the street, point by point.
    let line: Pt[];
    if (tree && chosen.i >= 0) {
      line = [];
      for (let i = chosen.i; i >= 0; i = tree.back[i]) line.push(g.pts[i]);
      line.reverse();
      line = [here, ...line, chosen.enter];
    } else {
      line = [here, chosen.enter];
      straight += 1;
    }
    let m = 0;
    for (let i = 1; i < line.length; i++) m += dist(line[i - 1], line[i]);
    linkM += m;
    links.push(line);
    here = chosen.leave;
  }
  // Streets without lines keep their place at the end.
  for (const s of streets) if (!ends.has(s.key)) out.push(s);
  return { streets: out, links, linkM, straight };
}

/** The metres of road between streets in a given order (to compare orders). */
export function linkMetres(
  roads: Pt[][] | Graph,
  streets: WayStreet[],
  start: Pt | null,
): number {
  const g = Array.isArray(roads) ? graphOf(roads) : roads;
  let total = 0;
  let here = start;
  for (const s of streets) {
    const e = endsOf(s.lines);
    if (!e) continue;
    if (here) {
      const a = nearestPoint(g, here);
      const tree = a && a.m <= OFF_ROAD_M ? fromPoint(g, a.i) : null;
      const via = (p: Pt) => {
        const n = nearestPoint(g, p);
        return tree && n && n.m <= OFF_ROAD_M && Number.isFinite(tree.m[n.i])
          ? tree.m[n.i]
          : dist(here!, p) * 1.4;
      };
      const [m0, m1] = [via(e[0]), via(e[1])];
      total += Math.min(m0, m1);
      here = m0 <= m1 ? e[1] : e[0];
    } else here = e[1];
  }
  return total;
}

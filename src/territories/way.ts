import { dist, type Pt } from './split';

/**
 * The way through a part (14 November 2026, «путь по дорогам»): the roads
 * of the map as a graph, and through it the order of a part's streets and
 * the stretches of road from one street to the next, so a pair can follow
 * one line from the start to the last house — and knows how far it goes
 * today (`TODAY_M`).
 *
 * The map's lines come cut at tile edges and simplified: a crossing need
 * not share a point. So the lines are cut in steps of STEP_M and points of
 * different lines closer than JOIN_M are joined.
 *
 * Measured on every territory first (14 November 2026): the roads between
 * streets were nearly as long as the streets; the order by road cut them
 * by a quarter, but plain «nearest next» was worse than today's order in
 * one part of six — so both orders are improved and the shorter is kept:
 * never worse than before.
 */

/** Lines are cut in steps of this length… */
export const STEP_M = 20;
/** …and points of two lines this close are one crossing. */
export const JOIN_M = 12;
/** A street end further than this from every road: walked to straight. */
export const OFF_ROAD_M = 80;
/** Off the roads, a straight line counts this much longer. */
const STRAIGHT_FACTOR = 1.4;
/** Roads further than this from a part's streets play no part in its way (a bridge may be some way off). */
const AROUND_M = 1000;
/** About one outing of a pair (14 November 2026: «около 1 км за выход»). */
export const TODAY_M = 1000;

export interface Graph {
  pts: Pt[];
  /** Neighbours of each point, with the metres to them. */
  next: { to: number; m: number }[][];
  /** Points by a grid of CELL_M, to find the nearest fast. */
  cells: Map<string, number[]>;
  k: number;
}

const CELL_M = 50;
const cellOf = (p: Pt, k: number): [number, number] => [
  Math.floor((p[0] * k) / CELL_M),
  Math.floor((p[1] * 110_540) / CELL_M),
];

/** The roads as a graph. */
export function graphOf(lines: Pt[][]): Graph {
  const pts: Pt[] = [];
  const next: { to: number; m: number }[][] = [];
  const lineOf: number[] = [];
  const add = (p: Pt, li: number) => {
    pts.push(p);
    next.push([]);
    lineOf.push(li);
    return pts.length - 1;
  };
  const link = (a: number, b: number) => {
    if (a === b) return;
    const m = dist(pts[a], pts[b]);
    next[a].push({ to: b, m });
    next[b].push({ to: a, m });
  };
  lines.forEach((raw, li) => {
    let prev = -1;
    for (let j = 0; j < raw.length; j++) {
      if (j === 0) {
        prev = add(raw[0], li);
        continue;
      }
      const a = raw[j - 1];
      const b = raw[j];
      const steps = Math.max(1, Math.ceil(dist(a, b) / STEP_M));
      for (let q = 1; q <= steps; q++) {
        const i = add(
          [
            a[0] + ((b[0] - a[0]) * q) / steps,
            a[1] + ((b[1] - a[1]) * q) / steps,
          ],
          li,
        );
        link(prev, i);
        prev = i;
      }
    }
  });
  const k = 111_320 * Math.cos(((pts[0]?.[1] ?? 51) * Math.PI) / 180);
  const cells = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const [x, y] = cellOf(p, k);
    const key = `${x}:${y}`;
    const list = cells.get(key);
    if (list) list.push(i);
    else cells.set(key, [i]);
  });
  // Crossings: points of different lines close together.
  pts.forEach((p, i) => {
    const [x, y] = cellOf(p, k);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of cells.get(`${x + dx}:${y + dy}`) ?? []) {
          if (j <= i || lineOf[j] === lineOf[i]) continue;
          if (dist(p, pts[j]) <= JOIN_M) link(i, j);
        }
  });
  return { pts, next, cells, k };
}

/** The point of the graph nearest to p within `within` metres, or null. */
export function nearestPoint(
  g: Graph,
  p: Pt,
  within = OFF_ROAD_M,
): { i: number; m: number } | null {
  const [x, y] = cellOf(p, g.k);
  const r = Math.ceil(within / CELL_M);
  let best: { i: number; m: number } | null = null;
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++)
      for (const i of g.cells.get(`${x + dx}:${y + dy}`) ?? []) {
        const m = dist(p, g.pts[i]);
        if (m <= within && (!best || m < best.m)) best = { i, m };
      }
  return best;
}

/** Shortest distances from one point to all (Dijkstra), with the way back. */
function fromPoint(g: Graph, a: number): { m: Float64Array; back: Int32Array } {
  const m = new Float64Array(g.pts.length).fill(Infinity);
  const back = new Int32Array(g.pts.length).fill(-1);
  m[a] = 0;
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

/** Metres along lines. */
export function lengthOf(lines: Pt[][]): number {
  let m = 0;
  for (const l of lines)
    for (let i = 1; i < l.length; i++) m += dist(l[i - 1], l[i]);
  return m;
}

/** A line thinned: points closer than `m` metres to the straight between their neighbours go. */
export function thin(line: Pt[], m = 3): Pt[] {
  if (line.length <= 2) return line;
  const k = 111_320 * Math.cos((line[0][1] * Math.PI) / 180);
  const off = (p: Pt, a: Pt, b: Pt) => {
    const ax = (p[0] - a[0]) * k;
    const ay = (p[1] - a[1]) * 110_540;
    const bx = (b[0] - a[0]) * k;
    const by = (b[1] - a[1]) * 110_540;
    const len = Math.hypot(bx, by);
    return len ? Math.abs(ax * by - ay * bx) / len : Math.hypot(ax, ay);
  };
  const keep = new Array<boolean>(line.length).fill(false);
  keep[0] = keep[line.length - 1] = true;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let fm = m;
    for (let i = a + 1; i < b; i++) {
      const d = off(line[i], line[a], line[b]);
      if (d > fm) {
        fm = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

export interface WayStreet {
  key: string;
  lines: Pt[][];
}

export interface Way<T> {
  /** The streets in the order to walk them. */
  streets: T[];
  /** links[i]: the road to streets[i] — from the start, then from the street before. */
  links: Pt[][];
  /** Metres of each street as drawn. */
  walkM: number[];
  /** The first `today` streets: about one outing (TODAY_M, at least one). */
  today: number;
  /** Metres of road between streets in this order, and in the order given. */
  linkM: number;
  linkGiven: number;
  /** Links with no road: a straight line. */
  straight: number;
}

/**
 * The order to walk a part's streets and the roads between them. Two
 * orders are tried — the one given (nearest by straight line) and nearest
 * by road — each improved by turning stretches of it round (2-opt), each
 * street entered at whichever end makes the whole shortest; the shorter is
 * kept, so it is never longer than the order given.
 */
export function routePart<T extends WayStreet>(
  roads: Pt[][],
  streets: T[],
  start: Pt | null,
  todayM = TODAY_M,
): Way<T> {
  const withEnds = streets
    .map((s) => ({ s, e: endsOf(s.lines) }))
    .filter((x): x is { s: T; e: [Pt, Pt] } => !!x.e);
  const loose = streets.filter((s) => !endsOf(s.lines));
  const n = withEnds.length;
  if (n === 0)
    return {
      streets,
      links: streets.map(() => []),
      walkM: streets.map(() => 0),
      today: Math.min(1, streets.length),
      linkM: 0,
      linkGiven: 0,
      straight: 0,
    };
  // Only the roads round the part: a smaller graph, the same ways.
  const pts = [
    ...withEnds.flatMap((x) => x.s.lines.flat()),
    ...(start ? [start] : []),
  ];
  const k = 111_320 * Math.cos((pts[0][1] * Math.PI) / 180);
  const mx = AROUND_M / k;
  const my = AROUND_M / 110_540;
  const w = Math.min(...pts.map((p) => p[0])) - mx;
  const e = Math.max(...pts.map((p) => p[0])) + mx;
  const s0 = Math.min(...pts.map((p) => p[1])) - my;
  const n0 = Math.max(...pts.map((p) => p[1])) + my;
  // A road counts when its own box meets the part's: a long road with no
  // point near may still pass by.
  const g = graphOf(
    roads.filter((l) => {
      let lw = Infinity;
      let le = -Infinity;
      let ls = Infinity;
      let ln = -Infinity;
      for (const [x, y] of l) {
        lw = Math.min(lw, x);
        le = Math.max(le, x);
        ls = Math.min(ls, y);
        ln = Math.max(ln, y);
      }
      return le >= w && lw <= e && ln >= s0 && ls <= n0;
    }),
  );

  // The places that matter: 0 the start, then each street's two ends.
  const places: Pt[] = [start ?? withEnds[0].e[0]];
  for (const x of withEnds) places.push(x.e[0], x.e[1]);
  const snap = places.map((p) => nearestPoint(g, p)?.i ?? -1);
  const trees = new Map<number, { m: Float64Array; back: Int32Array }>();
  const tree = (i: number) => {
    let t = trees.get(i);
    if (!t) {
      t = fromPoint(g, i);
      trees.set(i, t);
    }
    return t;
  };
  const P = places.length;
  const D: number[][] = Array.from({ length: P }, () =>
    new Array<number>(P).fill(0),
  );
  const road: boolean[][] = Array.from({ length: P }, () =>
    new Array<boolean>(P).fill(false),
  );
  for (let a = 0; a < P; a++) {
    const t = snap[a] >= 0 ? tree(snap[a]) : null;
    for (let b = 0; b < P; b++) {
      if (a === b) continue;
      const m = t && snap[b] >= 0 ? t.m[snap[b]] : Infinity;
      if (Number.isFinite(m)) {
        D[a][b] = m;
        road[a][b] = true;
      } else D[a][b] = dist(places[a], places[b]) * STRAIGHT_FACTOR;
    }
  }
  const endIx = (s: number, end: 0 | 1) => 1 + 2 * s + end;

  // An order's length, each street entered at its better end (two states).
  const plan = (order: number[]) => {
    // best[e]: shortest to have walked order[0..i] and left at end e.
    let best: [number, number] = [0, 0];
    const choice: (0 | 1)[][] = [];
    order.forEach((s, i) => {
      const nb: [number, number] = [Infinity, Infinity];
      const ch: (0 | 1)[] = [0, 0];
      for (const leave of [0, 1] as const) {
        const enter = (1 - leave) as 0 | 1;
        const to = endIx(s, enter);
        for (const was of [0, 1] as const) {
          const from = i === 0 ? 0 : endIx(order[i - 1], was);
          if (i === 0 && was === 1) continue;
          const c = (i === 0 ? 0 : best[was]) + D[from][to];
          if (c < nb[leave]) {
            nb[leave] = c;
            ch[leave] = was;
          }
        }
      }
      best = nb;
      choice.push(ch);
    });
    const last: 0 | 1 = best[0] <= best[1] ? 0 : 1;
    // Back through the choices: which end each street was left at.
    const leaves: (0 | 1)[] = new Array(order.length);
    let cur = last;
    for (let i = order.length - 1; i >= 0; i--) {
      leaves[i] = cur;
      cur = choice[i][cur];
    }
    return { m: Math.min(best[0], best[1]), leaves };
  };
  const improve = (order: number[]) => {
    let o = [...order];
    let m = plan(o).m;
    for (let round = 0; round < 8; round++) {
      let better = false;
      for (let i = 0; i < o.length - 1; i++)
        for (let j = i + 1; j < o.length; j++) {
          const t = [
            ...o.slice(0, i),
            ...o.slice(i, j + 1).reverse(),
            ...o.slice(j + 1),
          ];
          const tm = plan(t).m;
          if (tm < m - 0.5) {
            o = t;
            m = tm;
            better = true;
          }
        }
      if (!better) break;
    }
    return o;
  };
  const given = withEnds.map((_, i) => i);
  // Nearest next by road.
  const greedy: number[] = [];
  {
    const left = new Set(given);
    let here = 0;
    while (left.size) {
      let bs = -1;
      let bm = Infinity;
      let bl: 0 | 1 = 1;
      for (const s of left)
        for (const enter of [0, 1] as const) {
          const m = D[here][endIx(s, enter)];
          if (m < bm) {
            bm = m;
            bs = s;
            bl = (1 - enter) as 0 | 1;
          }
        }
      greedy.push(bs);
      left.delete(bs);
      here = endIx(bs, bl);
    }
  }
  const linkGiven = plan(given).m;
  const candidates = [given, improve(given), improve(greedy)];
  let order = given;
  let om = linkGiven;
  for (const c of candidates) {
    const m = plan(c).m;
    if (m < om - 0.5) {
      order = c;
      om = m;
    }
  }
  const { leaves } = plan(order);

  // The links themselves, along the roads.
  const links: Pt[][] = [];
  let straight = 0;
  let from = 0;
  order.forEach((s, i) => {
    const enter = (1 - leaves[i]) as 0 | 1;
    const to = endIx(s, enter);
    if (road[from][to]) {
      const t = tree(snap[from]);
      const line: Pt[] = [];
      for (let p = snap[to]; p >= 0; p = t.back[p]) line.push(g.pts[p]);
      line.reverse();
      links.push(thin([places[from], ...line, places[to]]));
    } else {
      links.push([places[from], places[to]]);
      straight += 1;
    }
    from = endIx(s, leaves[i]);
  });
  const ordered = order.map((i) => withEnds[i].s);
  const walkM = ordered.map((s) => lengthOf(s.lines));
  let today = 0;
  let acc = 0;
  for (let i = 0; i < ordered.length; i++) {
    acc += lengthOf([links[i]]) + walkM[i];
    if (i > 0 && acc > todayM) break;
    today = i + 1;
  }
  return {
    streets: [...ordered, ...loose],
    links: [...links, ...loose.map(() => [])],
    walkM: [...walkM, ...loose.map(() => 0)],
    today,
    linkM: om,
    linkGiven,
    straight,
  };
}

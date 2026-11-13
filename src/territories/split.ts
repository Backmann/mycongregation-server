/**
 * Dividing a territory between pairs for one day (13 November 2026; mockups
 * «Участок на группы» and «Пары на участке»).
 *
 * The houses are those of the register (map_houses: sheds and garages under
 * 35 m² are left out), with the house numbers the map gives them — one per
 * entrance of a block of flats. A house weighs as many doors as it has
 * numbers (at least one): a block with three entrances is three times the
 * work of a cottage.
 *
 *  1. Each house goes to the nearest named street — unless its number does
 *     not fit that street's numbers there and fits a street crossing nearby
 *     (a corner house numbered on the side street).
 *  2. A main road with houses on both sides is walked side by side: each
 *     side its own «street», named «even»/«odd» when the numbers agree, or by
 *     the compass. A quiet street is walked whole, both sides by one pair.
 *  3. A long street (side) is walked in pieces, named by their numbers
 *     («1–35») or else by the streets that cross where it is cut.
 *  4. The streets are cut into parts of about equal doors: «own» halves the
 *     territory again and again; «near» cuts it in wedges round one starting
 *     point, so the pairs start together and stay neighbours. Then evened
 *     out by moving streets at the edges, never leaving an island.
 *  5. In each part the streets are put in walking order from where it
 *     starts.
 *
 * Pure: no database, no clock.
 */

export type Pt = [number, number];

export interface StreetLines {
  name: string;
  /** The map's kind: «major_road», «highway», «minor_road», «path»… */
  kind?: string;
  lines: Pt[][];
}

export interface House {
  id: string;
  at: Pt;
  /** House numbers of the building, «12», «12a»; empty when the map has none. */
  numbers?: string[];
}

export interface PlanStreet {
  /** Unique within the plan: the name, the side, the piece. */
  key: string;
  name: string;
  /** A piece of a long street: where it starts and ends, by crossing streets. */
  from: string | null;
  to: string | null;
  /** 1-based; with `pieces` > 1 the street (side) is walked in pieces. */
  piece: number;
  pieces: number;
  /** A side of a main road; null: both sides. */
  side: null | {
    parity: 'even' | 'odd' | null;
    /** Where the side lies from the road: north, south, east, west. */
    toward: 'n' | 's' | 'e' | 'w';
  };
  /** Its house numbers from the lowest to the highest; null when too few are known. */
  range: null | { from: string; to: string };
  houses: number;
  /** Entrances: a house with three numbers is three. */
  doors: number;
  /** The houses that are its own (OpenStreetMap ids)… */
  homes: string[];
  /** …where they are, in the same order… */
  dots: Pt[];
  /** …and every house number on it. */
  nums: string[];
  /** Where its houses are, on average. */
  at: Pt;
  /** Its line near its own houses, to draw. */
  lines: Pt[][];
}

export interface PlanPart {
  /** 1-based. */
  n: number;
  houses: number;
  doors: number;
  /** In walking order from `start`. */
  streets: PlanStreet[];
  /** Where the part begins: its house nearest the common start. */
  start: Pt | null;
  /** «Smaller»: asked for about two thirds of an even share. */
  smaller?: boolean;
}

export type SplitMode = 'own' | 'near';

/** A house further than this from every named street is left out (a barn in a field)… */
export const FAR_M = 150;
/**
 * …unless it has a house number: a farm with an address on a road 300 m
 * away is a home to call at (14 November 2026: 153 houses of one rural
 * territory fell out at 150 m).
 */
export const FAR_NUMBERED_M = 500;
/** A street longer than this, from its first house to its last, is walked in pieces. */
export const PIECE_M = 400;
/** …but a piece keeps at least this many doors. */
export const PIECE_MIN_DOORS = 10;
/** A main road is walked by sides when it is at least this long… */
export const SIDES_MIN_M = 150;
/** …and each side has at least this many houses. */
export const SIDES_MIN_HOUSES = 4;
/** The map's kinds of road that are main roads. */
export const MAIN_ROADS = new Set([
  'highway',
  'major_road',
  'trunk',
  'primary',
]);
/** «Even»/«odd» only when this share of a side's numbers agree. */
export const PARITY_SHARE = 0.9;
/** A «smaller» part gets this share of an even one. */
export const SMALLER = 2 / 3;
/** A street that passes this close to where a long one is cut names the cut. */
const CROSS_M = 60;
/** A corner house may go to another street only when that street passes this close. */
const CORNER_M = 40;
/** Neighbours whose numbers say which street a house belongs to: this close. */
const NEIGHBOUR_M = 60;
/** A number fits a street when it is this close to a neighbour's number there. */
const FITS = 6;
/** The part of a street's line drawn is the part this close to its houses. */
const DRAW_M = 60;
/** …measured in steps of this length. */
const STEP_M = 20;

/** Metres per degree east at a latitude, and per degree north. */
function scale(lat: number): [number, number] {
  return [111_320 * Math.cos((lat * Math.PI) / 180), 110_540];
}

function segDist2(p: Pt, a: Pt, b: Pt, k: [number, number]): number {
  const ax = a[0] * k[0];
  const ay = a[1] * k[1];
  const bx = b[0] * k[0];
  const by = b[1] * k[1];
  const px = p[0] * k[0];
  const py = p[1] * k[1];
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t =
    len === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

function lineDist(p: Pt, lines: Pt[][]): number {
  const k = scale(p[1]);
  let best = Infinity;
  for (const line of lines) {
    for (let j = 1; j < line.length; j++) {
      best = Math.min(best, segDist2(p, line[j - 1], line[j], k));
    }
  }
  return Math.sqrt(best);
}

/** The segment of `lines` nearest to p, as [a, b]. */
function nearestSegment(p: Pt, lines: Pt[][]): [Pt, Pt] | null {
  const k = scale(p[1]);
  let best: [Pt, Pt] | null = null;
  let bestD = Infinity;
  for (const line of lines) {
    for (let j = 1; j < line.length; j++) {
      const d = segDist2(p, line[j - 1], line[j], k);
      if (d < bestD) {
        bestD = d;
        best = [line[j - 1], line[j]];
      }
    }
  }
  return best;
}

export function dist(a: Pt, b: Pt): number {
  const k = scale((a[1] + b[1]) / 2);
  return Math.hypot((a[0] - b[0]) * k[0], (a[1] - b[1]) * k[1]);
}

function middle(pts: Pt[]): Pt {
  const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [x, y];
}

/** «12a» → 12; null when it does not start with a number. */
export function numberOf(s: string): number | null {
  const m = /^\s*(\d+)/.exec(s);
  return m ? Number(m[1]) : null;
}

const byNumber = (a: string, b: string) =>
  (numberOf(a) ?? 0) - (numberOf(b) ?? 0) || a.localeCompare(b);

const doorsOf = (h: House) => Math.max(1, h.numbers?.length ?? 0);

/** Segments of `lines` that come within `metres` of one of `pts`. */
function linesNear(lines: Pt[][], pts: Pt[], metres: number): Pt[][] {
  if (pts.length === 0) return [];
  const k = scale(pts[0][1]);
  const out: Pt[][] = [];
  for (const raw of lines) {
    // A straight street is one long segment: cut it in steps of STEP_M so
    // only its stretch along the houses is kept.
    const line: Pt[] = [raw[0]];
    for (let j = 1; j < raw.length; j++) {
      const [a, b] = [raw[j - 1], raw[j]];
      const steps = Math.max(1, Math.ceil(dist(a, b) / STEP_M));
      for (let q = 1; q <= steps; q++) {
        line.push([
          a[0] + ((b[0] - a[0]) * q) / steps,
          a[1] + ((b[1] - a[1]) * q) / steps,
        ]);
      }
    }
    let run: Pt[] = [];
    for (let j = 1; j < line.length; j++) {
      const near = pts.some(
        (p) => segDist2(p, line[j - 1], line[j], k) <= metres * metres,
      );
      if (near) {
        if (run.length === 0) run.push(line[j - 1]);
        run.push(line[j]);
      } else if (run.length) {
        out.push(run);
        run = [];
      }
    }
    if (run.length) out.push(run);
  }
  return out;
}

/** The main direction of points, as a unit vector pointing east (or north). */
function axisOf(pts: Pt[]): { ux: number; uy: number; mx: number; my: number } {
  const k = scale(pts[0][1]);
  const [mx, my] = middle(pts);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const x = (p[0] - mx) * k[0];
    const y = (p[1] - my) * k[1];
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ux = Math.cos(angle);
  let uy = Math.sin(angle);
  if (ux < -1e-9 || (Math.abs(ux) < 1e-9 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  return { ux, uy, mx, my };
}

/**
 * Each house to its street, and the streets in sides and pieces (steps 1–3
 * above). Streets without a house are left out: nobody calls there.
 */
export function streetsWithHouses(
  streets: StreetLines[],
  houses: House[],
  opts: {
    /**
     * No piece more than this many doors: a street heavier than a pair's
     * share is cut further, so the parts can come out even (14 November
     * 2026: in small territories one street of 69 doors held a part up).
     */
    maxDoors?: number;
  } = {},
): { streets: PlanStreet[]; left: number } {
  const byName = new Map<string, Pt[][]>();
  const kindOf = new Map<string, string>();
  for (const s of streets) {
    const name = s.name.trim();
    if (!name) continue;
    byName.set(name, [...(byName.get(name) ?? []), ...s.lines]);
    // A name is a main road when any of its pieces is one.
    if (s.kind && (MAIN_ROADS.has(s.kind) || !kindOf.has(name))) {
      kindOf.set(name, s.kind);
    }
  }
  const names = [...byName.keys()];
  const near: { i: number; d: number }[][] = houses.map((h) =>
    names
      .map((name, i) => ({ i, d: lineDist(h.at, byName.get(name)!) }))
      .filter((c) => c.d <= (h.numbers?.length ? FAR_NUMBERED_M : FAR_M))
      .sort((a, b) => a.d - b.d),
  );
  const owner: number[] = near.map((c) => (c.length ? c[0].i : -1));
  fixCorners(houses, near, owner);
  lonelyShedsAway(
    houses,
    near,
    owner,
    names.map((name) =>
      byName
        .get(name)!
        .reduce(
          (a, l) => a + l.slice(1).reduce((b, p, j) => b + dist(l[j], p), 0),
          0,
        ),
    ),
  );

  const mine: number[][] = names.map(() => []);
  let left = 0;
  owner.forEach((i, hi) => {
    if (i >= 0) mine[i].push(hi);
    else left += 1;
  });
  const out: PlanStreet[] = [];
  names.forEach((name, i) => {
    if (mine[i].length === 0) return;
    const lines = byName.get(name)!;
    for (const side of sidesOf(
      name,
      kindOf.get(name),
      mine[i],
      houses,
      lines,
    )) {
      out.push(...piecesOf(name, side, houses, byName, opts.maxDoors));
    }
  });
  return { streets: out, left };
}

/**
 * A corner house numbered on the side street: its number does not fit the
 * numbers of its nearest street's houses round it, and fits those of a
 * street passing within CORNER_M. It goes to that street.
 */
function fixCorners(
  houses: House[],
  near: { i: number; d: number }[][],
  owner: number[],
) {
  const numbersNear = (hi: number, street: number): number[] => {
    const out: number[] = [];
    houses.forEach((o, oi) => {
      if (oi === hi || owner[oi] !== street) return;
      if (dist(o.at, houses[hi].at) > NEIGHBOUR_M) return;
      for (const n of o.numbers ?? []) {
        const v = numberOf(n);
        if (v !== null) out.push(v);
      }
    });
    return out;
  };
  const gap = (v: number, around: number[]) =>
    around.length ? Math.min(...around.map((a) => Math.abs(a - v))) : Infinity;
  houses.forEach((h, hi) => {
    const v = h.numbers?.length ? numberOf(h.numbers[0]) : null;
    if (v === null || owner[hi] < 0) return;
    const here = gap(v, numbersNear(hi, owner[hi]));
    if (here <= FITS) return;
    for (const c of near[hi]) {
      if (c.i === owner[hi] || c.d > CORNER_M) continue;
      if (gap(v, numbersNear(hi, c.i)) <= FITS) {
        owner[hi] = c.i;
        return;
      }
    }
  });
}

/** A named line shorter than this is a drive or a yard, not a street to walk. */
export const DRIVE_M = 80;

/**
 * A short named line (a drive, a yard: «Post») that got a single house
 * without a number: the house goes to its next nearest street. A real
 * street with one house keeps it.
 */
function lonelyShedsAway(
  houses: House[],
  near: { i: number; d: number }[][],
  owner: number[],
  lengths: number[],
) {
  const count = new Map<number, number[]>();
  owner.forEach((i, hi) => {
    if (i >= 0) count.set(i, [...(count.get(i) ?? []), hi]);
  });
  for (const [street, own] of count) {
    if (own.length !== 1) continue;
    const hi = own[0];
    if (houses[hi].numbers?.length || lengths[street] >= DRIVE_M) continue;
    const next = near[hi].find((c) => c.i !== street);
    if (next) owner[hi] = next.i;
  }
}

interface SideOf {
  own: number[];
  side: PlanStreet['side'];
}

/**
 * A main road with enough houses on both sides comes back as two sides;
 * any other street whole. The side of a house: left or right of the road's
 * nearest segment, the segment turned to run along the road's main axis.
 */
function sidesOf(
  name: string,
  kind: string | undefined,
  own: number[],
  houses: House[],
  lines: Pt[][],
): SideOf[] {
  const whole = [{ own, side: null }];
  if (!kind || !MAIN_ROADS.has(kind) || own.length < 2 * SIDES_MIN_HOUSES) {
    return whole;
  }
  const pts = own.map((i) => houses[i].at);
  const { ux, uy, mx, my } = axisOf(pts);
  const k = scale(pts[0][1]);
  const along = pts.map(
    (p) => (p[0] - mx) * k[0] * ux + (p[1] - my) * k[1] * uy,
  );
  if (Math.max(...along) - Math.min(...along) < SIDES_MIN_M) return whole;
  const left: number[] = [];
  const right: number[] = [];
  for (const i of own) {
    const p = houses[i].at;
    const seg = nearestSegment(p, lines);
    if (!seg) return whole;
    let dx = (seg[1][0] - seg[0][0]) * k[0];
    let dy = (seg[1][1] - seg[0][1]) * k[1];
    if (dx * ux + dy * uy < 0) {
      dx = -dx;
      dy = -dy;
    }
    const px = (p[0] - seg[0][0]) * k[0];
    const py = (p[1] - seg[0][1]) * k[1];
    (dx * py - dy * px > 0 ? left : right).push(i);
  }
  if (left.length < SIDES_MIN_HOUSES || right.length < SIDES_MIN_HOUSES) {
    return whole;
  }
  // Left of a road running east is its north side.
  const toward = (s: 1 | -1): 'n' | 's' | 'e' | 'w' => {
    const nx = -uy * s;
    const ny = ux * s;
    return Math.abs(ny) >= Math.abs(nx)
      ? ny > 0
        ? 'n'
        : 's'
      : nx > 0
        ? 'e'
        : 'w';
  };
  return [
    { own: left, side: { parity: parityOf(left, houses), toward: toward(1) } },
    {
      own: right,
      side: { parity: parityOf(right, houses), toward: toward(-1) },
    },
  ];
}

/** «Even»/«odd» when at least PARITY_SHARE of a side's numbers agree. */
export function parityOf(
  own: number[],
  houses: House[],
): 'even' | 'odd' | null {
  let even = 0;
  let odd = 0;
  for (const i of own) {
    for (const n of houses[i].numbers ?? []) {
      const v = numberOf(n);
      if (v === null) continue;
      if (v % 2 === 0) even += 1;
      else odd += 1;
    }
  }
  const all = even + odd;
  // Too few numbers to say: by the compass.
  if (all < SIDES_MIN_HOUSES) return null;
  if (even / all >= PARITY_SHARE) return 'even';
  if (odd / all >= PARITY_SHARE) return 'odd';
  return null;
}

/**
 * A long street (or side) in pieces of about equal doors along it, west (or
 * south) first (12 November 2026: in one town territory a 3 km road with 191
 * houses ran through every part).
 */
function piecesOf(
  name: string,
  { own, side }: SideOf,
  houses: House[],
  byName: Map<string, Pt[][]>,
  maxDoors?: number,
): PlanStreet[] {
  const pts = own.map((i) => houses[i].at);
  const k = scale(pts[0][1]);
  const { ux, uy, mx, my } = axisOf(pts);
  const along = own
    .map((i) => ({
      i,
      t:
        (houses[i].at[0] - mx) * k[0] * ux + (houses[i].at[1] - my) * k[1] * uy,
    }))
    .sort((a, b) => a.t - b.t);
  const length = along[along.length - 1].t - along[0].t;
  const doors = own.reduce((a, i) => a + doorsOf(houses[i]), 0);
  const byLength = Math.min(
    Math.ceil(length / PIECE_M),
    Math.floor(doors / PIECE_MIN_DOORS),
  );
  // Heavier than a pair's share: in pieces however short, one house at least each.
  const byShare = maxDoors
    ? Math.min(Math.ceil(doors / maxDoors), own.length)
    : 1;
  const n = Math.max(1, byLength, byShare);
  // Cut where the doors balance, not the houses.
  const slices: (typeof along)[] = [];
  let acc = 0;
  let cur: typeof along = [];
  for (const q of along) {
    const d = doorsOf(houses[q.i]);
    // Into the next piece once this one has its share (by the house's middle).
    if (
      cur.length &&
      slices.length < n - 1 &&
      acc + d / 2 > (doors * (slices.length + 1)) / n
    ) {
      slices.push(cur);
      cur = [];
    }
    cur.push(q);
    acc += d;
  }
  if (cur.length) slices.push(cur);
  const m = slices.length;
  const ownLines = byName.get(name) ?? [];
  const cuts: (string | null)[] = [];
  for (let j = 0; j + 1 < m; j++) {
    const a = houses[slices[j][slices[j].length - 1].i].at;
    const b = houses[slices[j + 1][0].i].at;
    cuts.push(crossingAt([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], name, byName));
  }
  const sideKey = side ? `@${side.toward}` : '';
  return slices.map((part, j) => {
    const homes = part.map((q) => houses[q.i]);
    const nums = homes.flatMap((h) => h.numbers ?? []).sort(byNumber);
    const numbered = homes.filter((h) => h.numbers?.length).length;
    return {
      key: `${name}${sideKey}${m === 1 ? '' : `#${j + 1}`}`,
      name,
      from: j > 0 ? cuts[j - 1] : null,
      to: j + 1 < m ? cuts[j] : null,
      piece: j + 1,
      pieces: m,
      side,
      // A range only when most of its houses have a number: else it misleads.
      range:
        nums.length && numbered * 2 >= homes.length
          ? { from: nums[0], to: nums[nums.length - 1] }
          : null,
      houses: homes.length,
      doors: homes.reduce((a, h) => a + doorsOf(h), 0),
      homes: homes.map((h) => h.id),
      dots: homes.map((h) => h.at),
      nums,
      at: middle(homes.map((h) => h.at)),
      lines: linesNear(
        ownLines,
        homes.map((h) => h.at),
        DRAW_M,
      ),
    };
  });
}

/** The other street nearest to a point, if one passes within CROSS_M. */
function crossingAt(
  p: Pt,
  self: string,
  byName: Map<string, Pt[][]>,
): string | null {
  let best: string | null = null;
  let bestD = CROSS_M;
  for (const [name, lines] of byName) {
    if (name === self) continue;
    const d = lineDist(p, lines);
    if (d <= bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

export interface SplitOptions {
  mode?: SplitMode;
  /** The common start: the meeting place, or the middle of the territory. */
  start?: Pt | null;
  /** Parts (1-based) that asked to be smaller. */
  smaller?: number[];
}

/**
 * The streets in `parts` parts of about equal doors (step 4), each in
 * walking order (step 5).
 */
export function splitStreets(
  streets: PlanStreet[],
  parts: number,
  opts: SplitOptions = {},
): PlanPart[] {
  const want = Math.max(1, Math.floor(parts));
  const smaller = new Set(opts.smaller ?? []);
  const weights = Array.from({ length: want }, (_, i) =>
    smaller.has(i + 1) ? SMALLER : 1,
  );
  const start =
    opts.start ?? (streets.length ? middle(streets.map((s) => s.at)) : null);
  const groups =
    opts.mode === 'near' && start
      ? wedges(streets, weights, start)
      : halves(streets, weights);

  const sum = (g: PlanStreet[]) => g.reduce((a, s) => a + s.doors, 0);
  // How far from even, each part measured against its own share.
  const spread = () => {
    const h = groups.map((g, i) => sum(g) / weights[i]);
    return Math.max(...h) - Math.min(...h);
  };
  const nearest = (s: PlanStreet, g: PlanStreet[]) =>
    g.reduce((m, o) => (o === s ? m : Math.min(m, dist(s.at, o.at))), Infinity);

  // Even out: at most a few hundred small moves, each one an improvement.
  for (let round = 0; round < 400 && groups.length > 1; round++) {
    const before = spread();
    const share = groups.map((g, i) => sum(g) / weights[i]);
    const heavy = share.indexOf(Math.max(...share));
    const light = share.indexOf(Math.min(...share));
    let moved = false;
    const candidates: { s: PlanStreet; from: number; to: number; d: number }[] =
      [];
    groups.forEach((g, from) => {
      if (g.length <= 1) return;
      for (const s of g) {
        const home = nearest(s, g);
        groups.forEach((other, to) => {
          if (to === from || other.length === 0) return;
          if (from !== heavy && to !== light) return;
          const d = nearest(s, other);
          // Next to that part, at least about as near as to its own: no islands.
          if (d <= home * 1.5) candidates.push({ s, from, to, d });
        });
      }
    });
    candidates.sort((a, b) => a.d - b.d);
    for (const c of candidates) {
      groups[c.from] = groups[c.from].filter((x) => x !== c.s);
      groups[c.to] = [...groups[c.to], c.s];
      if (spread() < before - 1e-9) {
        moved = true;
        break;
      }
      groups[c.to] = groups[c.to].filter((x) => x !== c.s);
      groups[c.from] = [...groups[c.from], c.s];
    }
    if (!moved) break;
  }

  return groups.map((list, i) => ({
    ...partOf(i + 1, list, start),
    ...(smaller.has(i + 1) ? { smaller: true } : {}),
  }));
}

/** «Own»: the territory halved again and again along its longer side. */
function halves(streets: PlanStreet[], weights: number[]): PlanStreet[][] {
  if (weights.length <= 1 || streets.length <= 1) {
    return [streets, ...weights.slice(1).map(() => [])];
  }
  const xs = streets.map((s) => s.at[0]);
  const ys = streets.map((s) => s.at[1]);
  const k = scale((Math.min(...ys) + Math.max(...ys)) / 2);
  const wide =
    (Math.max(...xs) - Math.min(...xs)) * k[0] >=
    (Math.max(...ys) - Math.min(...ys)) * k[1];
  // North first when cutting across: parts read top to bottom on the map.
  const sorted = [...streets].sort((a, b) =>
    wide ? a.at[0] - b.at[0] : b.at[1] - a.at[1],
  );
  const leftN = Math.floor(weights.length / 2);
  const wl = weights.slice(0, leftN).reduce((a, b) => a + b, 0);
  const wall = weights.reduce((a, b) => a + b, 0);
  const total = sorted.reduce((a, s) => a + s.doors, 0);
  const want = (total * wl) / wall;
  let acc = 0;
  let at = 1;
  let bestGap = Infinity;
  for (let i = 0; i < sorted.length - 1; i++) {
    acc += sorted[i].doors;
    const gap = Math.abs(acc - want);
    if (gap < bestGap) {
      bestGap = gap;
      at = i + 1;
    }
  }
  return [
    ...halves(sorted.slice(0, at), weights.slice(0, leftN)),
    ...halves(sorted.slice(at), weights.slice(leftN)),
  ];
}

/**
 * «Near»: wedges round the common start, so every part touches it and the
 * pairs stay neighbours. The first cut goes through the widest gap between
 * streets (a park, a field), clockwise from north after that.
 */
function wedges(
  streets: PlanStreet[],
  weights: number[],
  start: Pt,
): PlanStreet[][] {
  if (weights.length <= 1 || streets.length <= 1) {
    return [streets, ...weights.slice(1).map(() => [])];
  }
  const k = scale(start[1]);
  const angleOf = (s: PlanStreet) => {
    const a = Math.atan2(
      (s.at[0] - start[0]) * k[0],
      (s.at[1] - start[1]) * k[1],
    );
    return a < 0 ? a + 2 * Math.PI : a;
  };
  const sorted = streets
    .map((s) => ({ s, a: angleOf(s) }))
    .sort((x, y) => x.a - y.a);
  let widest = 0;
  let gapAt = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next =
      i + 1 < sorted.length ? sorted[i + 1].a : sorted[0].a + 2 * Math.PI;
    if (next - sorted[i].a > widest) {
      widest = next - sorted[i].a;
      gapAt = (i + 1) % sorted.length;
    }
  }
  const ring = [...sorted.slice(gapAt), ...sorted.slice(0, gapAt)].map(
    (x) => x.s,
  );
  const total = ring.reduce((a, s) => a + s.doors, 0);
  const wall = weights.reduce((a, b) => a + b, 0);
  const out: PlanStreet[][] = weights.map(() => []);
  let acc = 0;
  let part = 0;
  let bound = (total * weights[0]) / wall;
  for (const s of ring) {
    // Into the next part once this one has its share (by the street's middle).
    while (part < weights.length - 1 && acc + s.doors / 2 > bound) {
      part += 1;
      bound += (total * weights[part]) / wall;
    }
    out[part].push(s);
    acc += s.doors;
  }
  return out;
}

/**
 * A part from its streets, in walking order: from the house nearest the
 * common start, each time to the nearest street not yet walked, entering it
 * at its nearest house and leaving at its far end.
 */
export function partOf(
  n: number,
  list: PlanStreet[],
  from?: Pt | null,
): PlanPart {
  const houses = list.reduce((a, s) => a + s.houses, 0);
  const doors = list.reduce((a, s) => a + s.doors, 0);
  if (list.length === 0) return { n, houses, doors, streets: [], start: null };
  const dotsOf = (s: PlanStreet) => (s.dots.length ? s.dots : [s.at]);
  const ref = from ?? middle(list.map((s) => s.at));
  let here = list
    .flatMap(dotsOf)
    .reduce((b, p) => (dist(p, ref) < dist(b, ref) ? p : b));
  const start = here;
  const left = [...list];
  const ordered: PlanStreet[] = [];
  while (left.length) {
    let bi = 0;
    let bd = Infinity;
    left.forEach((s, i) => {
      const d = Math.min(...dotsOf(s).map((p) => dist(p, here)));
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    const s = left.splice(bi, 1)[0];
    ordered.push(s);
    const entry = dotsOf(s).reduce((b, p) =>
      dist(p, here) < dist(b, here) ? p : b,
    );
    here = dotsOf(s).reduce((b, p) =>
      dist(p, entry) > dist(b, entry) ? p : b,
    );
  }
  return { n, houses, doors, streets: ordered, start };
}

/** How even the parts are: the largest over the smallest, by doors (1 is perfect). */
export function unevenness(
  parts: { doors: number; smaller?: boolean }[],
): number {
  const h = parts.map((p) => p.doors / (p.smaller ? SMALLER : 1));
  const min = Math.min(...h);
  return min === 0 ? Infinity : Math.max(...h) / min;
}

/** A street name or an address, compared: «Schleusenstr. 8» ~ «Schleusenstraße». */
export function streetKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/\s*\d.*$/, '')
    .replace(/str\.?$/, 'strasse')
    .replace(/[\s.\-–]+/g, '');
}

/** The number of an address, «Dillweg 12a» → «12a»; null without one. */
export function addressNumber(address: string): string | null {
  const m = /(\d+\s*[a-zA-Z]?)\s*$/.exec(address.replace(/,.*$/, '').trim());
  return m ? m[1].replace(/\s+/g, '').toLowerCase() : null;
}

/**
 * The parts a «не посещать» address lies in. With its number found on a
 * street of the division: that one part. Else every part that walks its
 * street — two when a long one is walked in pieces. None when its street is
 * in no part; the caller then tells every part, so nobody misses it.
 */
export function partsOfAddress(parts: PlanPart[], address: string): number[] {
  const want = streetKey(address);
  if (!want) return [];
  const no = addressNumber(address);
  const onStreet = parts.filter((p) =>
    p.streets.some((s) => streetKey(s.name) === want),
  );
  if (no) {
    const exact = onStreet.filter((p) =>
      p.streets.some(
        (s) =>
          streetKey(s.name) === want &&
          s.nums.some((x) => x.toLowerCase() === no),
      ),
    );
    if (exact.length) return exact.map((p) => p.n);
  }
  return onStreet.map((p) => p.n);
}

/**
 * Where an address is on the map, from our own register: a house within
 * CORNER_M of a street of that name, holding that number. Null when the
 * address is not of that shape («at the shop») or the number is not known.
 */
export function findAddress(
  address: string,
  streets: StreetLines[],
  houses: House[],
): Pt | null {
  const want = streetKey(address);
  const no = addressNumber(address);
  if (!want || !no) return null;
  const lines = streets
    .filter((s) => streetKey(s.name) === want)
    .flatMap((s) => s.lines);
  if (!lines.length) return null;
  const found = houses.find(
    (h) =>
      (h.numbers ?? []).some((x) => x.toLowerCase() === no) &&
      lineDist(h.at, lines) <= CORNER_M,
  );
  return found ? found.at : null;
}

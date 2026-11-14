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
 *     not fit that street's numbers there and fits a street nearby (a corner
 *     house numbered on the side street; a house far out of the street's
 *     row of numbers; on a main road, a house of the other kind than its
 *     side — 14 November 2026).
 *  2. A main road with houses on both sides is walked side by side: each
 *     side its own «street», named «even»/«odd» when the numbers agree, or by
 *     the compass; both «sides» numbered alike are one side, walked whole.
 *     A quiet street is walked whole, both sides by one pair.
 *  3. A long street (side) is walked in pieces, named by their numbers —
 *     odd and even each on its own, as on the doors («1–35 · 2–40») — or
 *     else by the streets that cross where it is cut. Each side's numbers
 *     run on from one piece to the next, never across.
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
  /**
   * Its street by the official address (14 November 2026, «Gebäudereferenzen
   * NW»): when known, the house goes to it, not to the nearest street.
   */
  street?: string | null;
}

/** An official address: street, number, point (`map_addresses`). */
export interface Address {
  at: Pt;
  number: string;
  street: string;
}

/** An address belongs to a house of the map when this close and of its number. */
export const ADDRESS_M = 40;

/**
 * Each house of the map its street by the official addresses: an address of
 * one of its numbers within ADDRESS_M (in a trial town 99% of the houses
 * with a number found theirs). A block with entrances on two streets goes
 * to the one most of its numbers name. Houses without a number, or whose
 * address is not found, keep no street: they are placed by distance.
 */
export function withStreets(houses: House[], addresses: Address[]): House[] {
  if (addresses.length === 0) return houses;
  const k = scale(houses[0]?.at[1] ?? addresses[0].at[1]);
  const cellOf = (p: Pt) =>
    `${Math.floor((p[0] * k[0]) / ADDRESS_M)}:${Math.floor((p[1] * k[1]) / ADDRESS_M)}`;
  const grid = new Map<string, Address[]>();
  for (const a of addresses) {
    const c = cellOf(a.at);
    grid.set(c, [...(grid.get(c) ?? []), a]);
  }
  const around = (p: Pt) => {
    const [x, y] = cellOf(p).split(':').map(Number);
    const out: Address[] = [];
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        out.push(...(grid.get(`${x + i}:${y + j}`) ?? []));
    return out;
  };
  return houses.map((h) => {
    const mine = new Set((h.numbers ?? []).map((n) => n.toLowerCase()));
    if (mine.size === 0) return h;
    const votes = new Map<string, number>();
    for (const a of around(h.at)) {
      if (!mine.has(a.number.toLowerCase()) || dist(a.at, h.at) > ADDRESS_M)
        continue;
      votes.set(a.street, (votes.get(a.street) ?? 0) + 1);
    }
    if (votes.size === 0) return h;
    const street = [...votes].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0][0];
    return { ...h, street };
  });
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
  /**
   * Its numbers as the doors say them, each side of the street on its own:
   * «1–35» odd and «2–40» even (14 November 2026). A number far from the
   * others of its side (another street's, misplaced) is left out of it.
   */
  ranges: { odd: NumberRange | null; even: NumberRange | null };
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

export interface NumberRange {
  from: string;
  to: string;
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
/** Numbers of one side further apart than this are not one row of houses. */
export const RANGE_GAP = 20;
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
  // A house whose official address names a street the map has near it goes
  // there and stays: nothing below moves it.
  const sure = houses.map((h, hi) => {
    if (!h.street) return false;
    const own = near[hi].find((c) => names[c.i] === h.street);
    if (!own) return false;
    owner[hi] = own.i;
    return true;
  });
  fixCorners(houses, near, owner, sure);
  straysAway(houses, near, owner, sure);
  sideStraysAway(
    houses,
    near,
    owner,
    sure,
    names
      .map((name, i) => ({ i, name }))
      .filter(({ name }) => MAIN_ROADS.has(kindOf.get(name) ?? ''))
      .map(({ i, name }) => ({ i, lines: byName.get(name)! })),
  );
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
  sure: boolean[] = [],
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
    if (v === null || owner[hi] < 0 || sure[hi]) return;
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

/** A house far out of its street's numbers may go to a street this close… */
export const STRAY_M = 120;
/** …when that street's row has at least this many numbers to compare with. */
const ROW_MIN = 3;

/** The main row of numbers (lowest, highest) of a list, as in `rangesOf`. */
function rowOf(values: number[]): [number, number] | null {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return null;
  let best: number[] = [];
  let cur: number[] = [];
  for (const x of v) {
    if (cur.length && x - cur[cur.length - 1] > RANGE_GAP) {
      if (cur.length > best.length) best = cur;
      cur = [];
    }
    cur.push(x);
  }
  if (cur.length > best.length) best = cur;
  return best.length >= ROW_MIN ? [best[0], best[best.length - 1]] : null;
}

/**
 * A house whose number is far out of its street's row (14 November 2026:
 * «2», «3», «4» among 80–190 of a main road — houses of a side street
 * nearer to the main road's line) goes to a street within STRAY_M whose
 * houses round it carry numbers that fit. Houses out of line together do
 * not vouch for each other: the test is against the street's whole row.
 */
function straysAway(
  houses: House[],
  near: { i: number; d: number }[][],
  owner: number[],
  sure: boolean[] = [],
) {
  const rows = new Map<string, [number, number] | null>();
  const rowFor = (street: number, parity: number) => {
    const key = `${street}:${parity}`;
    if (!rows.has(key)) {
      const values: number[] = [];
      owner.forEach((o, hi) => {
        if (o !== street) return;
        for (const n of houses[hi].numbers ?? []) {
          const v = numberOf(n);
          if (v !== null && v % 2 === parity) values.push(v);
        }
      });
      rows.set(key, rowOf(values));
    }
    return rows.get(key)!;
  };
  const moves: [number, number][] = [];
  houses.forEach((h, hi) => {
    const v = h.numbers?.length ? numberOf(h.numbers[0]) : null;
    if (v === null || owner[hi] < 0 || sure[hi]) return;
    const row = rowFor(owner[hi], v % 2);
    if (row && v >= row[0] - RANGE_GAP && v <= row[1] + RANGE_GAP) return;
    // No row of its own side at all: out of line only when the other side
    // has one (an odd «3» on a street of 80–190 even).
    if (!row && !rowFor(owner[hi], 1 - (v % 2))) return;
    for (const c of near[hi]) {
      if (c.i === owner[hi] || c.d > STRAY_M) continue;
      if (fitsNear(houses, owner, hi, c.i, v)) {
        moves.push([hi, c.i]);
        return;
      }
    }
  });
  for (const [hi, to] of moves) owner[hi] = to;
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
  if (!kind || !MAIN_ROADS.has(kind)) return whole;
  const split = sideSplit(own, houses, lines);
  if (!split) return whole;
  const { left, right, ux, uy } = split;
  // Both «sides» numbered alike are one side of the road: the territory
  // holds only that side, and the road's bend put some of it «across»
  // (14 November 2026: Warendorfer Straße came as «east 2–190a» and «west»).
  const a = leanOf(left, houses);
  if (a !== null && a === leanOf(right, houses)) return whole;
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

/**
 * The houses of a road left and right of it (left of a road running east is
 * its north side); null when the road is too short or a side too thin to be
 * walked on its own.
 */
function sideSplit(
  own: number[],
  houses: House[],
  lines: Pt[][],
): { left: number[]; right: number[]; ux: number; uy: number } | null {
  if (own.length < 2 * SIDES_MIN_HOUSES) return null;
  const pts = own.map((i) => houses[i].at);
  const { ux, uy, mx, my } = axisOf(pts);
  const k = scale(pts[0][1]);
  const along = pts.map(
    (p) => (p[0] - mx) * k[0] * ux + (p[1] - my) * k[1] * uy,
  );
  if (Math.max(...along) - Math.min(...along) < SIDES_MIN_M) return null;
  const left: number[] = [];
  const right: number[] = [];
  for (const i of own) {
    const p = houses[i].at;
    const seg = nearestSegment(p, lines);
    if (!seg) return null;
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
    return null;
  }
  return { left, right, ux, uy };
}

/**
 * On a main road numbered odd on one side and even on the other, a house
 * whose number is of the other kind than its side (14 November 2026: even
 * «16», «18», «26», «28» on the odd side of Heessener Straße, «16» and «28»
 * there twice) is a house of another street close to the road: it goes to
 * a street within STRAY_M whose houses round it carry numbers that fit.
 */
function sideStraysAway(
  houses: House[],
  near: { i: number; d: number }[][],
  owner: number[],
  sure: boolean[],
  roads: { i: number; lines: Pt[][] }[],
) {
  for (const { i, lines } of roads) {
    const own: number[] = [];
    owner.forEach((o, hi) => {
      if (o === i) own.push(hi);
    });
    const split = sideSplit(own, houses, lines);
    if (!split) continue;
    const a = leanOf(split.left, houses);
    const b = leanOf(split.right, houses);
    if (a === null || b === null || a === b) continue;
    const moves: [number, number][] = [];
    for (const [side, lean] of [
      [split.left, a],
      [split.right, b],
    ] as const) {
      for (const hi of side) {
        if (sure[hi]) continue;
        const v = houses[hi].numbers?.length
          ? numberOf(houses[hi].numbers![0])
          : null;
        if (v === null || (v % 2 === 0 ? 'even' : 'odd') === lean) continue;
        const to = near[hi].find(
          (c) =>
            c.i !== i && c.d <= STRAY_M && fitsNear(houses, owner, hi, c.i, v),
        );
        if (to) moves.push([hi, to.i]);
      }
    }
    for (const [hi, to] of moves) owner[hi] = to;
  }
}

/** A house's number fits a street's numbers on the houses round it. */
function fitsNear(
  houses: House[],
  owner: number[],
  hi: number,
  street: number,
  v: number,
): boolean {
  return houses.some(
    (o, oi) =>
      oi !== hi &&
      owner[oi] === street &&
      dist(o.at, houses[hi].at) <= NEIGHBOUR_M &&
      (o.numbers ?? []).some((n) => {
        const w = numberOf(n);
        return w !== null && Math.abs(w - v) <= FITS;
      }),
  );
}

/** Most numbers of a side even, or odd: at least SIDE_LEAN of them, and enough to say. */
export const SIDE_LEAN = 0.75;

function leanOf(own: number[], houses: House[]): 'even' | 'odd' | null {
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
  if (all < 2) return null;
  if (even / all >= SIDE_LEAN) return 'even';
  if (odd / all >= SIDE_LEAN) return 'odd';
  return null;
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
  if (slices.length > 1) numbersInRows(slices, houses);
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
      ranges:
        nums.length && numbered * 2 >= homes.length
          ? rangesOf(nums)
          : { odd: null, even: null },
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

/**
 * The odd and the even numbers of a street (piece) as rows: within a side
 * the numbers run on with small gaps; the longest row is the side's, a
 * number far from it (another street's house nearby) stays out of the label.
 */
export function rangesOf(nums: string[]): {
  odd: NumberRange | null;
  even: NumberRange | null;
} {
  const row = (want: 0 | 1): NumberRange | null => {
    const own = nums
      .filter((x) => {
        const v = numberOf(x);
        return v !== null && v % 2 === want;
      })
      .sort(byNumber);
    if (own.length === 0) return null;
    let best: string[] = [];
    let cur: string[] = [];
    for (const x of own) {
      const prev = cur.length ? numberOf(cur[cur.length - 1])! : null;
      if (prev !== null && numberOf(x)! - prev > RANGE_GAP) {
        if (cur.length > best.length) best = cur;
        cur = [];
      }
      cur.push(x);
    }
    if (cur.length > best.length) best = cur;
    return { from: best[0], to: best[best.length - 1] };
  };
  const odd = row(1);
  const even = row(0);
  // One lone number beside a whole row of the other side is no side of its own.
  const lone = (r: NumberRange | null) => !!r && r.from === r.to;
  const many = (r: NumberRange | null) => !!r && r.from !== r.to;
  return {
    odd: lone(odd) && many(even) ? null : odd,
    even: lone(even) && many(odd) ? null : even,
  };
}

/**
 * Pieces cut where the doors balance run across each other's numbers when
 * the two sides of a street are not numbered in step (14 November 2026:
 * «1–25 · 2–16» and «5–41 · 50–98» on one street). Each side's numbers are
 * dealt out again in their own order, as many to each piece as it had of
 * that side: the pieces keep their size and place, and a piece's numbers
 * run on from the last one's («1–23 · 2–48», «25–41 · 50–98»). A side
 * numbered against the street's direction is dealt from its other end.
 * Numbers out of the side's row (another street's) and houses without one
 * stay where they stood.
 */
function numbersInRows(
  slices: { i: number; t: number }[][],
  houses: House[],
): void {
  for (const parity of [1, 0]) {
    const values: number[] = [];
    for (const sl of slices)
      for (const q of sl) {
        const v = firstNumber(houses[q.i]);
        if (v !== null && v % 2 === parity) values.push(v);
      }
    const row = rowOf(values);
    if (!row) continue;
    const inRow = (q: { i: number }) => {
      const v = firstNumber(houses[q.i]);
      return v !== null && v % 2 === parity && v >= row[0] && v <= row[1];
    };
    const counts = slices.map((sl) => sl.filter(inRow).length);
    const items = slices.flatMap((sl) => sl.filter(inRow));
    if (items.length < 2) continue;
    // Which way the numbers run along the street: the lower half of them
    // lies before or after the upper half.
    const byNo = [...items].sort(
      (a, b) =>
        firstNumber(houses[a.i])! - firstNumber(houses[b.i])! ||
        byNumber(houses[a.i].numbers![0], houses[b.i].numbers![0]),
    );
    const half = Math.floor(byNo.length / 2);
    const mean = (xs: { t: number }[]) =>
      xs.reduce((a, q) => a + q.t, 0) / Math.max(1, xs.length);
    if (mean(byNo.slice(0, half)) > mean(byNo.slice(byNo.length - half))) {
      byNo.reverse();
    }
    let next = 0;
    slices.forEach((sl, j) => {
      const keep = sl.filter((q) => !inRow(q));
      const dealt = byNo.slice(next, next + counts[j]);
      next += counts[j];
      slices[j] = [...keep, ...dealt].sort((a, b) => a.t - b.t);
    });
  }
}

const firstNumber = (h: House): number | null =>
  h.numbers?.length ? numberOf(h.numbers[0]) : null;

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
  // A house whose official address is this one (14 November 2026).
  const official = houses.find(
    (h) =>
      !!h.street &&
      streetKey(h.street) === want &&
      (h.numbers ?? []).some((x) => x.toLowerCase() === no),
  );
  if (official) return official.at;
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

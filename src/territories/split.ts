/**
 * Dividing a territory between groups for one day (13 November 2026).
 * The houses are those of the register (map_houses: sheds and garages
 * under 35 m² are already left out), so a part's count matches the
 * territory's count everywhere else.
 *
 * The map holds no house numbers, so a part is a set of whole streets — or of
 * pieces of a long one, cut where its houses are and named by the streets
 * that cross it there («from Ostring to the end»). Each house of the register
 * inside the territory goes to the nearest named street; a street weighs as
 * many houses as it got. The streets are then cut into parts by halving the
 * territory again and again along its longer side at the weighted middle, and
 * evened out by moving streets at the edges — parts lie side by side, not
 * mixed. Ported from the app's first draft (12 November 2026), where it was
 * tried on the congregation's real territories.
 *
 * Pure: no database, no clock.
 */

export type Pt = [number, number];

export interface StreetLines {
  name: string;
  lines: Pt[][];
}

export interface House {
  id: string;
  at: Pt;
}

export interface PlanStreet {
  /** Unique within the plan: the name, and the piece of a long street. */
  key: string;
  name: string;
  /** A piece of a long street: where it starts and ends, by crossing streets. */
  from: string | null;
  to: string | null;
  /** 1-based; with `pieces` > 1 the street is walked in pieces. */
  piece: number;
  pieces: number;
  houses: number;
  /** The houses of the register that are its own (OpenStreetMap ids). */
  homes: string[];
  /** Where its houses are, on average. */
  at: Pt;
  /** Its line near its own houses, to draw. */
  lines: Pt[][];
}

export interface PlanPart {
  /** 1-based. */
  n: number;
  houses: number;
  streets: PlanStreet[];
  /** A house in the middle of the part: where the route leads. */
  start: Pt | null;
}

/** A house further than this from every named street is left out (a barn in a field). */
export const FAR_M = 150;
/** A street longer than this, from its first house to its last, is walked in pieces. */
export const PIECE_M = 400;
/** …but a piece keeps at least this many houses. */
export const PIECE_MIN_HOUSES = 10;
/** A street that passes this close to where a long one is cut names the cut. */
const CROSS_M = 60;
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

function dist(a: Pt, b: Pt): number {
  const k = scale((a[1] + b[1]) / 2);
  return Math.hypot((a[0] - b[0]) * k[0], (a[1] - b[1]) * k[1]);
}

function middle(pts: Pt[]): Pt {
  const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [x, y];
}

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

/**
 * Each house to its nearest named street. Streets of the same name are one
 * street; a long one comes back in pieces (see PIECE_M), each named by the
 * streets crossing it where it is cut. Streets without a house are left out:
 * nobody calls there.
 */
export function streetsWithHouses(
  streets: StreetLines[],
  houses: House[],
): { streets: PlanStreet[]; left: number } {
  const byName = new Map<string, Pt[][]>();
  for (const s of streets) {
    const name = s.name.trim();
    if (!name) continue;
    byName.set(name, [...(byName.get(name) ?? []), ...s.lines]);
  }
  const names = [...byName.keys()];
  const mine: number[][] = names.map(() => []);
  let left = 0;
  houses.forEach((h, hi) => {
    const k = scale(h.at[1]);
    let best = -1;
    let bestD = FAR_M * FAR_M;
    names.forEach((name, i) => {
      for (const line of byName.get(name)!) {
        for (let j = 1; j < line.length; j++) {
          const d = segDist2(h.at, line[j - 1], line[j], k);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    });
    if (best >= 0) mine[best].push(hi);
    else left += 1;
  });
  const out: PlanStreet[] = [];
  names.forEach((name, i) => {
    if (mine[i].length === 0) return;
    out.push(...piecesOf(name, mine[i], houses, byName));
  });
  return { streets: out, left };
}

/**
 * A long street in pieces of about equal houses along it, west (or south)
 * first (12 November 2026: in one town territory a 3 km road with 191
 * houses ran through every part).
 */
function piecesOf(
  name: string,
  own: number[],
  houses: House[],
  byName: Map<string, Pt[][]>,
): PlanStreet[] {
  const pts = own.map((i) => houses[i].at);
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
  // The street's main direction, pointing east (or north when it runs north).
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ux = Math.cos(angle);
  let uy = Math.sin(angle);
  if (ux < -1e-9 || (Math.abs(ux) < 1e-9 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  const along = own
    .map((i) => ({
      i,
      t:
        (houses[i].at[0] - mx) * k[0] * ux + (houses[i].at[1] - my) * k[1] * uy,
    }))
    .sort((a, b) => a.t - b.t);
  const length = along[along.length - 1].t - along[0].t;
  const n = Math.max(
    1,
    Math.min(
      Math.ceil(length / PIECE_M),
      Math.floor(own.length / PIECE_MIN_HOUSES),
    ),
  );
  const own_lines = byName.get(name) ?? [];
  const slices = Array.from({ length: n }, (_, j) =>
    along.slice(
      Math.round((j * along.length) / n),
      Math.round(((j + 1) * along.length) / n),
    ),
  );
  // Where piece j ends and j+1 begins: the street that crosses there.
  const cuts: (string | null)[] = [];
  for (let j = 0; j + 1 < n; j++) {
    const a = houses[slices[j][slices[j].length - 1].i].at;
    const b = houses[slices[j + 1][0].i].at;
    cuts.push(crossingAt([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], name, byName));
  }
  return slices.map((part, j) => {
    const homes = part.map((q) => houses[q.i]);
    return {
      key: n === 1 ? name : `${name}#${j + 1}`,
      name,
      from: j > 0 ? cuts[j - 1] : null,
      to: j + 1 < n ? cuts[j] : null,
      piece: j + 1,
      pieces: n,
      houses: part.length,
      homes: homes.map((h) => h.id),
      at: middle(homes.map((h) => h.at)),
      lines: linesNear(
        own_lines,
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

/**
 * The streets in `parts` parts of about equal houses. First the territory is
 * halved again and again along its longer side where the houses balance;
 * then, while it makes the parts more even, a street at the edge of the
 * heaviest part moves to the neighbouring part it lies next to — never one
 * that would leave an island in another part's ground.
 */
export function splitStreets(streets: PlanStreet[], parts: number): PlanPart[] {
  const cut = (list: PlanStreet[], n: number): PlanStreet[][] => {
    if (n <= 1 || list.length <= 1) return [list];
    const xs = list.map((s) => s.at[0]);
    const ys = list.map((s) => s.at[1]);
    const k = scale((Math.min(...ys) + Math.max(...ys)) / 2);
    const wide =
      (Math.max(...xs) - Math.min(...xs)) * k[0] >=
      (Math.max(...ys) - Math.min(...ys)) * k[1];
    // North first when cutting across: parts read top to bottom on the map.
    const sorted = [...list].sort((a, b) =>
      wide ? a.at[0] - b.at[0] : b.at[1] - a.at[1],
    );
    const leftN = Math.floor(n / 2);
    const total = sorted.reduce((a, s) => a + s.houses, 0);
    const want = (total * leftN) / n;
    let acc = 0;
    let at = 1;
    let bestGap = Infinity;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += sorted[i].houses;
      const gap = Math.abs(acc - want);
      if (gap < bestGap) {
        bestGap = gap;
        at = i + 1;
      }
    }
    return [
      ...cut(sorted.slice(0, at), leftN),
      ...cut(sorted.slice(at), n - leftN),
    ];
  };
  const want = Math.max(1, Math.floor(parts));
  const groups = cut(streets, want);

  const sum = (g: PlanStreet[]) => g.reduce((a, s) => a + s.houses, 0);
  const spread = () => {
    const h = groups.map(sum);
    return Math.max(...h) - Math.min(...h);
  };
  const nearest = (s: PlanStreet, g: PlanStreet[]) =>
    g.reduce((m, o) => (o === s ? m : Math.min(m, dist(s.at, o.at))), Infinity);

  // Even out: at most a few hundred small moves, each one an improvement.
  for (let round = 0; round < 400 && groups.length > 1; round++) {
    const before = spread();
    const totals = groups.map(sum);
    const heavy = totals.indexOf(Math.max(...totals));
    const light = totals.indexOf(Math.min(...totals));
    let moved = false;
    const candidates: {
      s: PlanStreet;
      from: number;
      to: number;
      d: number;
    }[] = [];
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
      if (spread() < before) {
        moved = true;
        break;
      }
      groups[c.to] = groups[c.to].filter((x) => x !== c.s);
      groups[c.from] = [...groups[c.from], c.s];
    }
    if (!moved) break;
  }

  return groups.map((list, i) => partOf(i + 1, list));
}

/** A part from its streets: sorted, counted, with where the route leads. */
export function partOf(n: number, list: PlanStreet[]): PlanPart {
  const streets = [...list].sort(
    (a, b) => a.name.localeCompare(b.name, 'de') || a.piece - b.piece,
  );
  const houses = streets.reduce((a, s) => a + s.houses, 0);
  let start: Pt | null = null;
  if (streets.length) {
    const c = middle(streets.map((s) => s.at));
    start = streets
      .map((s) => s.at)
      .reduce((b, p) => (dist(p, c) < dist(b, c) ? p : b));
  }
  return { n, houses, streets, start };
}

/** How even the parts are: the largest over the smallest, by houses (1 is perfect). */
export function unevenness(parts: { houses: number }[]): number {
  const h = parts.map((p) => p.houses);
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

/**
 * The parts a «не посещать» address lies in, by its street (the address
 * holds no point): every part that walks that street — two when a long one
 * is walked in pieces. None when the street is in no part; the caller then
 * tells every part, so nobody misses it.
 */
export function partsOfAddress(parts: PlanPart[], address: string): number[] {
  const want = streetKey(address);
  if (!want) return [];
  return parts
    .filter((p) => p.streets.some((s) => streetKey(s.name) === want))
    .map((p) => p.n);
}

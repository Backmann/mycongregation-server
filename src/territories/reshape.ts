import { difference, intersection, union } from 'polygon-clipping';
import type { MultiPolygon, Polygon, Ring } from 'polygon-clipping';
import type { TerritoryGeometry } from '../entities/territory.entity';
import { checkGeometry } from './geometry';

/**
 * Cutting a territory in two and joining two into one (12 November 2026).
 * The outlines are computed here, on the server, so the editor only draws
 * the line or names the neighbour and shows what comes back.
 */

export class ReshapeError extends Error {
  constructor(
    readonly code:
      | 'LINE_SHORT'
      | 'LINE_CROSSES_ITSELF'
      | 'LINE_NOT_THROUGH'
      | 'LINE_MANY_PIECES'
      | 'NOT_TOUCHING'
      | 'SHAPE_WITH_HOLE',
    message: string,
  ) {
    super(message);
  }
}

/** Pieces smaller than this (m²) are slivers of a hand-drawn border. */
const SLIVER_M2 = 60;

function ringArea(r: Ring): number {
  const lat = r[0][1];
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    s += r[j][0] * kx * (r[i][1] * ky) - r[i][0] * kx * (r[j][1] * ky);
  }
  return Math.abs(s) / 2;
}

function polygonsOf(g: TerritoryGeometry): Polygon[] {
  return g.type === 'Polygon'
    ? [g.coordinates as Ring[]]
    : (g.coordinates as Ring[][]);
}

/** Drops slivers and tiny holes left where two hand-drawn borders meet. */
function clean(mp: MultiPolygon): Polygon[] {
  return mp
    .filter((poly) => ringArea(poly[0]) >= SLIVER_M2)
    .map((poly) => [
      poly[0],
      ...poly.slice(1).filter((h) => ringArea(h) >= SLIVER_M2),
    ]);
}

function asGeometry(poly: Polygon): TerritoryGeometry {
  return checkGeometry({ type: 'Polygon', coordinates: poly });
}

function segmentsCross(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const o = (p: number[], q: number[], r: number[]) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/**
 * Cuts a territory along a line drawn across it, into exactly two pieces.
 * The line's ends are carried far out, then one side of it is closed into
 * a large polygon: what lies inside it is one part, the rest the other.
 * A line that wanders through the territory several times would leave more
 * than two pieces: refused, the editor cannot hold a part of two pieces.
 */
export function splitByLine(
  g: TerritoryGeometry,
  raw: [number, number][],
): [TerritoryGeometry, TerritoryGeometry] {
  const line = raw.filter(
    (p, i) => i === 0 || p[0] !== raw[i - 1][0] || p[1] !== raw[i - 1][1],
  );
  if (line.length < 2) {
    throw new ReshapeError('LINE_SHORT', 'The line needs two points.');
  }
  for (let i = 1; i < line.length; i++) {
    for (let j = i + 2; j < line.length; j++) {
      if (segmentsCross(line[i - 1], line[i], line[j - 1], line[j])) {
        throw new ReshapeError(
          'LINE_CROSSES_ITSELF',
          'The line crosses itself.',
        );
      }
    }
  }
  // Carry both ends a long way out along their last segment.
  const FAR = 0.5;
  const out = (
    from: [number, number],
    to: [number, number],
  ): [number, number] => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    return [to[0] + (dx / len) * FAR, to[1] + (dy / len) * FAR];
  };
  const start = out(line[1], line[0]);
  const end = out(line[line.length - 2], line[line.length - 1]);
  const path: [number, number][] = [start, ...line, end];
  // The left of the path's overall direction, far away.
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * FAR * 4;
  const ny = (dx / len) * FAR * 4;
  const side: Ring = [
    ...path,
    [end[0] + nx, end[1] + ny],
    [start[0] + nx, start[1] + ny],
    path[0],
  ];
  const subject = polygonsOf(g);
  const left = clean(intersection(subject, [side]));
  const right = clean(difference(subject, [side]));
  if (left.length === 0 || right.length === 0) {
    throw new ReshapeError(
      'LINE_NOT_THROUGH',
      'The line must cross the territory from edge to edge.',
    );
  }
  if (left.length > 1 || right.length > 1) {
    throw new ReshapeError(
      'LINE_MANY_PIECES',
      'The line crosses the territory more than once.',
    );
  }
  return [asGeometry(left[0]), asGeometry(right[0])];
}

/**
 * Joins two neighbours into one outline. They must touch: two pieces apart
 * are not one territory. Slivers and pinholes between hand-drawn borders
 * are dropped; a real hole (a territory left inside) is refused, as the
 * editor cannot draw one.
 */
export function joinTwo(
  a: TerritoryGeometry,
  b: TerritoryGeometry,
): TerritoryGeometry {
  // Borders drawn by hand rarely meet exactly: corners within a couple of
  // metres of the other outline are put on it first, both ways.
  const pa = polygonsOf(a);
  const pb = snapOnto(polygonsOf(b), pa);
  const joined = clean(union(snapOnto(pa, pb), pb));
  if (joined.length !== 1) {
    throw new ReshapeError('NOT_TOUCHING', 'The two territories do not touch.');
  }
  if (joined[0].length > 1) {
    throw new ReshapeError(
      'SHAPE_WITH_HOLE',
      'Joined, they would leave a hole inside.',
    );
  }
  return asGeometry(joined[0]);
}

/** Corners closer than this (m) to the other outline are put on it. */
const SNAP_M = 2;

/** Moves each corner of `subject` onto `target`'s nearest edge when close. */
function snapOnto(subject: Polygon[], target: Polygon[]): Polygon[] {
  const lat = subject[0][0][0][1];
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  const edges: [number, number, number, number][] = [];
  for (const poly of target) {
    for (const r of poly) {
      for (let i = 1; i < r.length; i++) {
        edges.push([r[i - 1][0], r[i - 1][1], r[i][0], r[i][1]]);
      }
    }
  }
  const snap = ([x, y]: [number, number]): [number, number] => {
    let best: [number, number] = [x, y];
    let bestD = SNAP_M;
    for (const [ax, ay, bx, by] of edges) {
      const dx = (bx - ax) * kx;
      const dy = (by - ay) * ky;
      const len = dx * dx + dy * dy;
      const px = (x - ax) * kx;
      const py = (y - ay) * ky;
      const t =
        len === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len));
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d < bestD) {
        bestD = d;
        best = [ax + t * (bx - ax), ay + t * (by - ay)];
      }
    }
    return best;
  };
  return subject.map((poly) => poly.map((r) => r.map(snap)));
}

/** Area in m² of an outline (outer rings less holes). */
export function areaM2(g: TerritoryGeometry): number {
  return polygonsOf(g).reduce(
    (n, [outer, ...holes]) =>
      n + ringArea(outer) - holes.reduce((m, h) => m + ringArea(h), 0),
    0,
  );
}

/**
 * The next free number after the like-named ones: «Hamm42» among Hamm01 …
 * Hamm73 gives «Hamm74»; the width of the digits is kept («Ahlen07» →
 * «Ahlen14»), and a number without digits gets «-2».
 */
export function nextNumber(like: string, taken: string[]): string {
  const m = /^(.*?)(\d+)$/.exec(like.trim());
  const norm = (s: string) => s.trim().toLowerCase();
  const used = new Set(taken.map(norm));
  if (!m) {
    for (let i = 2; ; i++) {
      const c = `${like.trim()}-${i}`;
      if (!used.has(norm(c))) return c;
    }
  }
  const [, prefix, digits] = m;
  let max = 0;
  for (const t of taken) {
    const k = /^(.*?)(\d+)$/.exec(t.trim());
    if (k && norm(k[1]) === norm(prefix)) max = Math.max(max, Number(k[2]));
  }
  for (let n = max + 1; ; n++) {
    const c = `${prefix}${String(n).padStart(digits.length, '0')}`;
    if (!used.has(norm(c))) return c;
  }
}

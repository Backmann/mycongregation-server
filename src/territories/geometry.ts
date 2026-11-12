import type { TerritoryGeometry } from '../entities/territory.entity';

/**
 * Outlines as GeoJSON keeps them: rings of [lon, lat], the first ring the
 * outside, the others holes (11 November 2026).
 *
 * Nothing here needs a geometry library: an outline is checked for shape
 * (closed rings, real coordinates, a sane size) and compared with others by
 * where their corners lie. That finds the faults that matter on import — a
 * territory reaching past the congregation's boundary, two territories laid
 * over each other — without pretending to measure areas exactly.
 */

/** Far more than any hand-drawn territory needs; a guard against junk. */
export const MAX_POINTS = 5000;

export class GeometryError extends Error {}

type Ring = [number, number][];

function ringOf(raw: unknown, where: string): Ring {
  if (!Array.isArray(raw) || raw.length < 4) {
    throw new GeometryError(`${where}: a ring needs at least four points`);
  }
  const ring: Ring = raw.map((p, i) => {
    if (!Array.isArray(p) || p.length < 2) {
      throw new GeometryError(`${where}: point ${i} is not [lon, lat]`);
    }
    const lon = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new GeometryError(`${where}: point ${i} is not a number`);
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      throw new GeometryError(`${where}: point ${i} is off the map`);
    }
    // Six decimals is about ten centimetres: enough, and it keeps rows small.
    return [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
  });
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  return ring;
}

/**
 * A checked copy of an outline, or a GeometryError saying what is wrong.
 * Only Polygon and MultiPolygon: a territory is an area.
 */
export function checkGeometry(raw: unknown): TerritoryGeometry {
  if (!raw || typeof raw !== 'object') {
    throw new GeometryError('no outline');
  }
  const g = raw as { type?: unknown; coordinates?: unknown };
  let polygons: Ring[][];
  if (g.type === 'Polygon') {
    if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) {
      throw new GeometryError('a polygon needs a ring');
    }
    polygons = [g.coordinates.map((r, i) => ringOf(r, `ring ${i}`))];
  } else if (g.type === 'MultiPolygon') {
    if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) {
      throw new GeometryError('a multipolygon needs a polygon');
    }
    polygons = g.coordinates.map((poly, j) => {
      if (!Array.isArray(poly) || poly.length === 0) {
        throw new GeometryError(`polygon ${j} needs a ring`);
      }
      return poly.map((r, i) => ringOf(r, `polygon ${j} ring ${i}`));
    });
  } else {
    throw new GeometryError('only Polygon and MultiPolygon are areas');
  }
  const points = polygons.reduce(
    (n, poly) => n + poly.reduce((m, r) => m + r.length, 0),
    0,
  );
  if (points > MAX_POINTS) {
    throw new GeometryError(`too many points (${points} > ${MAX_POINTS})`);
  }
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

function polygonsOf(g: TerritoryGeometry): Ring[][] {
  return g.type === 'Polygon'
    ? [g.coordinates as Ring[]]
    : (g.coordinates as Ring[][]);
}

/** Even-odd test of one point against one ring. */
function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * How close to a border a point counts as ON it rather than inside: about two
 * metres. Neighbours share borders drawn by hand, and a corner of one lying a
 * hair inside the other is a shared border, not an overlap.
 */
const ON_BORDER = 2e-5;

function nearRing([x, y]: [number, number], ring: Ring): boolean {
  const k = Math.cos((y * Math.PI) / 180);
  for (let i = 1; i < ring.length; i++) {
    const ax = ring[i - 1][0] * k,
      ay = ring[i - 1][1],
      bx = ring[i][0] * k,
      by = ring[i][1],
      px = x * k;
    const dx = bx - ax,
      dy = by - ay;
    const len = dx * dx + dy * dy;
    const t =
      len === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - ax) * dx + (y - ay) * dy) / len));
    const ex = ax + t * dx - px,
      ey = ay + t * dy - y;
    if (ex * ex + ey * ey <= ON_BORDER * ON_BORDER) return true;
  }
  return false;
}

/** Strictly inside: inside, and not on (or a hair from) any of its borders. */
function strictlyInside(
  point: [number, number],
  g: TerritoryGeometry,
): boolean {
  if (!pointInside(point, g)) return false;
  return !polygonsOf(g).some((poly) => poly.some((r) => nearRing(point, r)));
}

/** Inside the area: within an outside ring and none of its holes. */
export function pointInside(
  point: [number, number],
  g: TerritoryGeometry,
): boolean {
  return polygonsOf(g).some(
    ([outer, ...holes]) =>
      inRing(point, outer) && !holes.some((h) => inRing(point, h)),
  );
}

function nearArea(point: [number, number], g: TerritoryGeometry): boolean {
  return polygonsOf(g).some((poly) => poly.some((r) => nearRing(point, r)));
}

function corners(g: TerritoryGeometry): [number, number][] {
  // The closing point repeats the first; counting it twice would skew shares.
  return polygonsOf(g).flatMap((poly) => poly[0].slice(0, -1));
}

/** The share of a territory's corners that lie outside an area, 0…1. */
export function shareOutside(
  g: TerritoryGeometry,
  area: TerritoryGeometry,
): number {
  const pts = corners(g);
  if (pts.length === 0) return 0;
  return (
    pts.filter((p) => !pointInside(p, area) && !nearArea(p, area)).length /
    pts.length
  );
}

/**
 * The share of a territory's AREA that lies outside an area, 0…1
 * (12 November 2026). Counting corners told the keeper «26 %» for a territory
 * with 3 % of its ground outside. Points are laid over the territory in an
 * even grid — densest along the longer side — and those inside it are
 * counted outside the area or not: within a per cent for any outline the
 * import accepts. Corners all inside and no border crossing: 0 at once.
 */
export function areaShareOutside(
  g: TerritoryGeometry,
  area: TerritoryGeometry,
  steps = 80,
): number {
  if (shareOutside(g, area) === 0 && !cutByBorder(g, area)) return 0;
  const [x1, y1, x2, y2] = boxOf(g);
  let inside = 0;
  let out = 0;
  for (let i = 0; i < steps; i++) {
    const x = x1 + ((i + 0.5) * (x2 - x1)) / steps;
    for (let j = 0; j < steps; j++) {
      const y = y1 + ((j + 0.5) * (y2 - y1)) / steps;
      if (!pointInside([x, y], g)) continue;
      inside += 1;
      if (!pointInside([x, y], area)) out += 1;
    }
  }
  return inside === 0 ? 0 : out / inside;
}

/**
 * Whether the area's own border cuts through the territory: one of the
 * area's corners lies strictly inside it. Catches a territory that pokes out
 * between two of its own corners, which counting its corners alone misses.
 */
export function cutByBorder(
  g: TerritoryGeometry,
  area: TerritoryGeometry,
): boolean {
  return corners(area).some((p) => strictlyInside(p, g));
}

/**
 * Whether two territories lie over each other: a corner of one strictly
 * inside the other. Shared borders do not count — neighbours share them.
 */
export function overlaps(a: TerritoryGeometry, b: TerritoryGeometry): boolean {
  return (
    corners(a).some((p) => strictlyInside(p, b)) ||
    corners(b).some((p) => strictlyInside(p, a))
  );
}

/** A rough box, to skip pairs that cannot touch. */
export function boxOf(g: TerritoryGeometry): [number, number, number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of corners(g)) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function boxesMeet(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

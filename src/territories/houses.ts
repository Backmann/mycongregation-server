import type { EntityManager } from 'typeorm';
import type { TerritoryGeometry } from '../entities/territory.entity';
import { TerritorySettings } from '../entities/territory-settings.entity';
import { boxOf, pointInside } from './geometry';

/** A house of the register: [lon, lat]. */
export type HousePoint = [number, number];

/** Houses that change hands when an outline is drawn again. */
export interface HouseShift {
  /** In the territory before. */
  before: number;
  /** In it before, not after. */
  leaving: number;
  /** In it after, not before. */
  coming: number;
}

/**
 * Counts the houses of the register inside the old and the new outline
 * (12 November 2026). Points outside both boxes are skipped at once.
 */
export function houseShift(
  before: TerritoryGeometry,
  after: TerritoryGeometry,
  houses: HousePoint[],
): HouseShift {
  const [a0, b0, a1, b1] = boxOf(before);
  const [c0, d0, c1, d1] = boxOf(after);
  let was = 0;
  let leaving = 0;
  let coming = 0;
  for (const p of houses) {
    const [x, y] = p;
    const inOld =
      x >= a0 && x <= a1 && y >= b0 && y <= b1 && pointInside(p, before);
    const inNew =
      x >= c0 && x <= c1 && y >= d0 && y <= d1 && pointInside(p, after);
    if (inOld) was += 1;
    if (inOld && !inNew) leaving += 1;
    if (!inOld && inNew) coming += 1;
  }
  return { before: was, leaving, coming };
}

/** The box round several outlines, for one query of the register. */
export function boxAround(
  shapes: TerritoryGeometry[],
): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const g of shapes) {
    const [a, b, c, d] = boxOf(g);
    x0 = Math.min(x0, a);
    y0 = Math.min(y0, b);
    x1 = Math.max(x1, c);
    y1 = Math.max(y1, d);
  }
  return [x0, y0, x1, y1];
}

/**
 * The houses of the register round the given outlines, or null while the
 * register has not been built for this congregation.
 */
export async function housesAround(
  m: EntityManager,
  tenantId: string,
  shapes: TerritoryGeometry[],
): Promise<HousePoint[] | null> {
  const settings = await m.findOne(TerritorySettings, {
    where: { congregationId: tenantId },
  });
  if (!settings?.housesBuiltAt) return null;
  const [x0, y0, x1, y1] = boxAround(shapes);
  const rows = await m.query<{ lon: number; lat: number }[]>(
    `SELECT lon, lat FROM map_houses
      WHERE congregation_id = $1 AND lat BETWEEN $2 AND $3 AND lon BETWEEN $4 AND $5`,
    [tenantId, y0, y1, x0, x1],
  );
  return rows.map((r) => [r.lon, r.lat]);
}

/** Houses of the register inside one outline. */
export function housesIn(g: TerritoryGeometry, houses: HousePoint[]): number {
  return houseShift(g, g, houses).before;
}

/**
 * The aerial photograph of North Rhine-Westphalia (Land NRW, «DOP», 20 cm,
 * open data under dl-de/zero-2.0), cut into the map's 512-pixel tiles
 * (R-67, 23 November 2026). Only the arithmetic lives here; the service asks
 * the Land's server and keeps a few tiles.
 */

/** Half the width of the web-Mercator world, in metres. */
const E = 20037508.342789244;

/** The zooms worth a photograph: below 12 it is a blur, above 19 it is enlarged. */
export const PHOTO_MIN_ZOOM = 12;
export const PHOTO_MAX_ZOOM = 19;

/** The Land, generously: the photograph exists nowhere else. lon/lat. */
export const NRW_BOX = {
  west: 5.8,
  south: 50.3,
  east: 9.5,
  north: 52.55,
} as const;

export const DOP_WMS = 'https://www.wms.nrw.de/geobasis/wms_nw_dop';

export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** A tile's square in EPSG:3857 metres: [minX, minY, maxX, maxY]. */
export function tileBox({ z, x, y }: Tile): [number, number, number, number] {
  const size = (2 * E) / 2 ** z;
  const minX = -E + x * size;
  const maxY = E - y * size;
  return [minX, maxY - size, minX + size, maxY];
}

const lonOf = (mx: number) => (mx / E) * 180;
const latOf = (my: number) =>
  (Math.atan(Math.exp((my / E) * Math.PI)) * 360) / Math.PI - 90;

/**
 * The tile, if it is one this service gives: whole numbers, a zoom worth a
 * photograph, inside the world, and touching the Land. Anything else — an
 * address in Spain, a zoom of 25, «1e3» — is no tile.
 */
export function photoTile(zs: string, xs: string, ys: string): Tile | null {
  if (![zs, xs, ys].every((s) => /^\d{1,7}$/.test(s))) return null;
  const z = Number(zs);
  const x = Number(xs);
  const y = Number(ys);
  if (z < PHOTO_MIN_ZOOM || z > PHOTO_MAX_ZOOM) return null;
  const n = 2 ** z;
  if (x >= n || y >= n) return null;
  const [minX, minY, maxX, maxY] = tileBox({ z, x, y });
  const west = lonOf(minX);
  const east = lonOf(maxX);
  const south = latOf(minY);
  const north = latOf(maxY);
  const touches =
    east > NRW_BOX.west &&
    west < NRW_BOX.east &&
    north > NRW_BOX.south &&
    south < NRW_BOX.north;
  return touches ? { z, x, y } : null;
}

/** The Land's map server, asked for exactly this tile. */
export function dopUrl(tile: Tile): string {
  const bbox = tileBox(tile)
    .map((v) => v.toFixed(3))
    .join(',');
  return (
    `${DOP_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=nw_dop_rgb` +
    `&STYLES=&CRS=EPSG:3857&BBOX=${bbox}&WIDTH=512&HEIGHT=512&FORMAT=image/jpeg`
  );
}

#!/usr/bin/env node
/**
 * The register of houses from a cut map file (12 November 2026).
 *
 *   node scripts/map-houses.mjs <map.pmtiles> <west,south,east,north> <congregationId>
 *
 * Reads every tile of the file's deepest zoom (15, the only one that holds
 * every building) inside the box, and prints one CSV line per building:
 *   congregation_id,osm_id,lon,lat,area_m2
 * A building that crosses tiles comes once: the largest piece of it (a tile
 * holds the building clipped to its edge plus a margin, so the largest piece
 * is the whole of it or nearly). Buildings under 35 m² — garages, sheds —
 * are left out. Run by .github/workflows/map.yml right after the cut; the
 * lines go into map_houses for that congregation, replacing the old ones.
 *
 * Public map data only: an OpenStreetMap id, a point, a footprint size.
 */
import { open } from 'node:fs/promises';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

export const MIN_AREA_M2 = 35;

class FileSource {
  constructor(path) {
    this.path = path;
    this.handle = null;
  }
  getKey() {
    return this.path;
  }
  async getBytes(offset, length) {
    this.handle ??= await open(this.path, 'r');
    const buf = Buffer.alloc(length);
    const { bytesRead } = await this.handle.read(buf, 0, length, offset);
    const slice = buf.subarray(0, bytesRead);
    return {
      data: slice.buffer.slice(
        slice.byteOffset,
        slice.byteOffset + slice.byteLength,
      ),
    };
  }
  async close() {
    await this.handle?.close();
  }
}

/** Area (m²) and middle of one outer ring, on a flat local projection. */
export function ringStats(ring) {
  const lat0 = ring[0][1];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0] * kx;
    const yi = ring[i][1] * ky;
    const xj = ring[j][0] * kx;
    const yj = ring[j][1] * ky;
    const f = xj * yi - xi * yj;
    a += f;
    cx += (xj + xi) * f;
    cy += (yj + yi) * f;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return null;
  return { area: Math.abs(a), lon: cx / (6 * a) / kx, lat: cy / (6 * a) / ky };
}

/** A building's piece in one tile: its outer rings summed. */
export function pieceOf(geometry) {
  const polys =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  let area = 0;
  let lon = 0;
  let lat = 0;
  for (const p of polys) {
    const s = p[0] ? ringStats(p[0]) : null;
    if (!s) continue;
    area += s.area;
    lon += s.lon * s.area;
    lat += s.lat * s.area;
  }
  return area > 0 ? { area, lon: lon / area, lat: lat / area } : null;
}

/** Keeps the largest piece per building id. */
export function addPiece(byId, id, piece) {
  if (id === undefined || id === null || !piece) return;
  const key = String(id);
  const had = byId.get(key);
  if (!had || piece.area > had.area) byId.set(key, piece);
}

export function tileRange(z, [w, s, e, n]) {
  const x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const y = (lat) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(
      ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
    );
  };
  return { x0: x(w), x1: x(e), y0: y(n), y1: y(s) };
}

async function main() {
  const [file, boxText, congregationId] = process.argv.slice(2);
  if (!file || !boxText || !/^[0-9a-f-]{36}$/.test(congregationId ?? '')) {
    console.error(
      'usage: map-houses.mjs <map.pmtiles> <w,s,e,n> <congregation uuid>',
    );
    process.exit(2);
  }
  const box = boxText.split(',').map(Number);
  if (box.length !== 4 || box.some((v) => !Number.isFinite(v))) {
    console.error('the box is four numbers: west,south,east,north');
    process.exit(2);
  }
  const source = new FileSource(file);
  const tiles = new PMTiles(source);
  const header = await tiles.getHeader();
  const z = header.maxZoom;
  const { x0, x1, y0, y1 } = tileRange(z, box);
  const byId = new Map();
  let read = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const resp = await tiles.getZxy(z, x, y);
      if (!resp) continue;
      read += 1;
      const layer = new VectorTile(new PbfReader(new Uint8Array(resp.data)))
        .layers.buildings;
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3) continue; // polygons only; points are labels
        addPiece(byId, f.id, pieceOf(f.toGeoJSON(x, y, z).geometry));
      }
    }
  }
  await source.close();
  const [w, s, e, n] = box;
  let out = 0;
  const lines = [];
  for (const [id, p] of byId) {
    if (p.area < MIN_AREA_M2) continue;
    if (p.lon < w || p.lon > e || p.lat < s || p.lat > n) continue;
    lines.push(
      `${congregationId},${id},${p.lon.toFixed(7)},${p.lat.toFixed(7)},${Math.round(p.area)}`,
    );
    out += 1;
  }
  process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
  console.error(
    `zoom ${z}: ${read} tiles, ${byId.size} buildings, ${out} houses written`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * The places of a cut map file (13 November 2026): shops, food, services,
 * doctors, hotels — every named point of the map's «pois» layer.
 *
 *   node scripts/map-places.mjs <map.pmtiles> <west,south,east,north> <congregationId>
 *
 * Reads every tile of the deepest zoom inside the box and prints one CSV line
 * per place: congregation_id,osm_id,kind,name,lon,lat (RFC 4180: the name in
 * quotes, a quote doubled). A place that shows in several tiles comes once.
 * Which kinds count as a business is the server's choice
 * (src/territories/business-kinds.ts), so a new kind needs no new map run.
 * Run by .github/workflows/map.yml right after the cut, next to the houses.
 *
 * Public map data only: an OpenStreetMap id, a kind, a name, a point.
 */
import { open } from 'node:fs/promises';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { tileRange } from './map-houses.mjs';

/** A name as one CSV field: quoted, quotes doubled, line breaks gone. */
export function csvText(s) {
  const one = String(s)
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 200);
  return `"${one.replace(/"/g, '""')}"`;
}

/** A kind as the map has it: lower-case letters, digits and «_» only. */
export function cleanKind(k) {
  return typeof k === 'string' && /^[a-z0-9_]{1,40}$/.test(k) ? k : null;
}

/** The middle of a place drawn as an area or a line, else the point. */
export function pointOf(geometry) {
  if (geometry.type === 'Point') return geometry.coordinates;
  const pts =
    geometry.type === 'Polygon'
      ? geometry.coordinates[0]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates[0][0]
        : geometry.type === 'LineString'
          ? geometry.coordinates
          : null;
  if (!pts || pts.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const [a, b] of pts) {
    x += a;
    y += b;
  }
  return [x / pts.length, y / pts.length];
}

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

async function main() {
  const [file, boxText, congregationId] = process.argv.slice(2);
  if (!file || !boxText || !/^[0-9a-f-]{36}$/.test(congregationId ?? '')) {
    console.error(
      'usage: map-places.mjs <map.pmtiles> <w,s,e,n> <congregation uuid>',
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
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const resp = await tiles.getZxy(z, x, y);
      if (!resp) continue;
      const layer = new VectorTile(new PbfReader(new Uint8Array(resp.data)))
        .layers.pois;
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.id === undefined || byId.has(String(f.id))) continue;
        const name = f.properties.name;
        const kind = cleanKind(f.properties.kind);
        if (typeof name !== 'string' || !name.trim() || !kind) continue;
        const p = pointOf(f.toGeoJSON(x, y, z).geometry);
        if (!p) continue;
        byId.set(String(f.id), { kind, name, lon: p[0], lat: p[1] });
      }
    }
  }
  await source.close();
  const [w, s, e, n] = box;
  const lines = [];
  for (const [id, p] of byId) {
    if (p.lon < w || p.lon > e || p.lat < s || p.lat > n) continue;
    lines.push(
      `${congregationId},${id},${p.kind},${csvText(p.name)},${p.lon.toFixed(7)},${p.lat.toFixed(7)}`,
    );
  }
  process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
  console.error(
    `zoom ${z}: ${byId.size} named places, ${lines.length} written`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

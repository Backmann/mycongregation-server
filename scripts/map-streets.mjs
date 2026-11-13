#!/usr/bin/env node
/**
 * The named streets of a cut map file (13 November 2026), for dividing a
 * territory between groups: each house goes to its nearest street.
 *
 *   node scripts/map-streets.mjs <map.pmtiles> <west,south,east,north> <congregationId>
 *   node scripts/map-streets.mjs --self-test
 *
 * Reads every tile of the deepest zoom inside the box (the «roads» layer)
 * and prints one CSV line per street:
 *   congregation_id,street_no,name,kind,west,south,east,north,lines
 * where lines is a JSON array of [lon, lat] lines. Pieces of one name that
 * meet (or nearly: within JOIN_M) are one street; the same name further away
 * — the main street of the next village — is another. Railways, ferries and
 * runways are not streets one walks. Run by .github/workflows/map.yml next to
 * the houses; the lines go into map_streets, replacing the old ones.
 *
 * Public map data only: a street name and its line.
 */
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { FileSource, tileRange } from './map-houses.mjs';
import { cleanKind, csvText } from './map-places.mjs';

/** Road kinds that are not streets to call along. */
export const NOT_STREETS = new Set(['rail', 'ferry', 'aeroway']);
/** Pieces of a name this close are one street (a crossing, a tile edge). */
export const JOIN_M = 40;
/** A line is thinned to within this many metres of itself. */
export const THIN_M = 2;

function scale(lat) {
  return [111320 * Math.cos((lat * Math.PI) / 180), 110540];
}

/** Douglas–Peucker on a flat local projection. */
export function thin(line, metres = THIN_M) {
  if (line.length <= 2) return line;
  const k = scale(line[0][1]);
  const keep = new Array(line.length).fill(false);
  keep[0] = keep[line.length - 1] = true;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = line[a][0] * k[0],
      ay = line[a][1] * k[1];
    const bx = line[b][0] * k[0],
      by = line[b][1] * k[1];
    const dx = bx - ax,
      dy = by - ay;
    const len = Math.hypot(dx, dy);
    let far = -1;
    let farD = metres;
    for (let i = a + 1; i < b; i++) {
      const px = line[i][0] * k[0],
        py = line[i][1] * k[1];
      const d =
        len === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far > 0) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

function near(p, q, k) {
  return Math.hypot((p[0] - q[0]) * k[0], (p[1] - q[1]) * k[1]) <= JOIN_M;
}

/**
 * Pieces of one name grouped into streets: two pieces are one street when a
 * point of one lies within JOIN_M of a point of the other. Lines are thinned
 * first, so their points are their bends — enough for a crossing.
 */
export function streetsOf(pieces) {
  if (pieces.length === 0) return [];
  const k = scale(pieces[0][0][1]);
  const parent = pieces.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (find(i) === find(j)) continue;
      if (pieces[i].some((p) => pieces[j].some((q) => near(p, q, k))))
        parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  pieces.forEach((p, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), p]);
  });
  return [...groups.values()];
}

export function boxOf(lines) {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const l of lines)
    for (const [x, y] of l) {
      w = Math.min(w, x);
      s = Math.min(s, y);
      e = Math.max(e, x);
      n = Math.max(n, y);
    }
  return [w, s, e, n];
}

const round = (line) => line.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]);

async function main() {
  const [file, boxText, congregationId] = process.argv.slice(2);
  if (!file || !boxText || !/^[0-9a-f-]{36}$/.test(congregationId ?? '')) {
    console.error(
      'usage: map-streets.mjs <map.pmtiles> <w,s,e,n> <congregation uuid>',
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
  const z = (await tiles.getHeader()).maxZoom;
  const { x0, x1, y0, y1 } = tileRange(z, box);
  /** name → { kind, pieces } */
  const byName = new Map();
  const seen = new Set();
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const resp = await tiles.getZxy(z, x, y);
      if (!resp) continue;
      const layer = new VectorTile(new PbfReader(new Uint8Array(resp.data)))
        .layers.roads;
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 2) continue;
        const name =
          typeof f.properties.name === 'string' ? f.properties.name.trim() : '';
        const kind = cleanKind(f.properties.kind) ?? 'other';
        if (!name || NOT_STREETS.has(kind)) continue;
        const g = f.toGeoJSON(x, y, z).geometry;
        const lines =
          g.type === 'LineString'
            ? [g.coordinates]
            : g.type === 'MultiLineString'
              ? g.coordinates
              : [];
        const had = byName.get(name) ?? { kind, pieces: [] };
        for (const l of lines) {
          if (l.length < 2) continue;
          const t = round(thin(l));
          // The same piece again in a neighbouring tile's margin.
          const key = JSON.stringify(t);
          if (seen.has(key)) continue;
          seen.add(key);
          had.pieces.push(t);
        }
        byName.set(name, had);
      }
    }
  }
  await source.close();
  const out = [];
  let no = 0;
  for (const [name, { kind, pieces }] of byName) {
    for (const lines of streetsOf(pieces)) {
      const [w, s, e, n] = boxOf(lines);
      no += 1;
      out.push(
        `${congregationId},${no},${csvText(name)},${kind},${w.toFixed(6)},${s.toFixed(6)},${e.toFixed(6)},${n.toFixed(6)},${csvText(JSON.stringify(lines), Infinity)}`,
      );
    }
  }
  process.stdout.write(out.join('\n') + (out.length ? '\n' : ''));
  console.error(
    `zoom ${z}: ${byName.size} street names, ${no} streets written`,
  );
}

function selfTest() {
  let bad = 0;
  const ok = (name, cond) => {
    if (!cond) {
      bad += 1;
      console.error(`✗ ${name}`);
    }
  };
  // 0.0009° north ≈ 100 m at 51° N; 0.0014° east ≈ 100 m.
  const a = [
    [7.0, 51.0],
    [7.0014, 51.0],
  ];
  const b = [
    [7.0014, 51.0],
    [7.0028, 51.0],
  ]; // continues a
  const far = [
    [7.05, 51.0],
    [7.0514, 51.0],
  ]; // the next village
  ok(
    'meeting pieces are one street, the far one another',
    streetsOf([a, b, far]).length === 2,
  );
  ok(
    'a street within JOIN_M joins',
    streetsOf([
      a,
      [
        [7.0, 51.0003],
        [7.0, 51.001],
      ],
    ]).length === 1,
  );
  ok(
    '…and further does not',
    streetsOf([
      a,
      [
        [7.0, 51.0006],
        [7.0, 51.001],
      ],
    ]).length === 2,
  );
  const wiggle = [
    [7.0, 51.0],
    [7.0007, 51.000005],
    [7.0014, 51.0],
    [7.0014, 51.0009],
  ];
  ok(
    'a straight bit thinned, the corner kept',
    JSON.stringify(thin(wiggle)) ===
      JSON.stringify([
        [7.0, 51.0],
        [7.0014, 51.0],
        [7.0014, 51.0009],
      ]),
  );
  ok(
    'box',
    JSON.stringify(boxOf([a, far])) ===
      JSON.stringify([7.0, 51.0, 7.0514, 51.0]),
  );
  if (bad) process.exit(1);
  console.log('map-streets self-test: OK');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === '--self-test') selfTest();
  else
    main().catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

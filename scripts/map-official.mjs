#!/usr/bin/env node
/**
 * What the cadastre says each building is (14 November 2026).
 *
 *   node scripts/map-official.mjs --districts <gebref.txt> <west,south,east,north>
 *   node scripts/map-official.mjs <houses.csv> <buildings.geojsonl>
 *   node scripts/map-official.mjs --self-test
 *
 * The map file knows a building's outline, not what it is: a workshop with
 * an address looked like a home. The cadastre of North Rhine-Westphalia
 * («ALKIS NW Grundrissdaten vereinfacht», Geobasis NRW, Datenlizenz
 * Deutschland – Zero 2.0) says it for every building: «Wohngebäude»,
 * «Gebäude für Wirtschaft oder Gewerbe», «Gebäude für Land- und
 * Forstwirtschaft» …
 *
 * --districts: the districts (Kreis keys, «05570») with an official address
 *   inside the box — the cadastre comes as one file per district, named
 *   after the key («gru_vereinf_05570000_…»).
 * Otherwise: for each house of houses.csv (map-houses.mjs: congregation_id,
 *   osm_id, lon, lat, area_m2, numbers) the cadastre building whose outline
 *   holds the house's middle — else the nearest within NEAR_M — printed as
 *   osm_id,function,floors,building. A house the cadastre does not know is not
 *   printed. buildings.geojsonl: one GeoJSON feature per line (ogr2ogr
 *   -f GeoJSONSeq, EPSG:4326) with the properties `funktion`, `anzahlgs`, `oid`
 *   (the building's own id: several houses of the map may be pieces of one
 *   building of the cadastre).
 *
 * Public data only: an outline and what it is used for.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { utm32ToLonLat } from './map-addresses.mjs';

/** A middle off its own outline (an L-shaped house) still finds it this close. */
export const NEAR_M = 6;
const CELL = 0.001; // degrees: about 70 × 110 m here

const kx = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);
const KY = 110_540;

/** The outer rings of a Polygon or MultiPolygon. */
function ringsOf(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates[0]];
  if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p[0]);
  return [];
}

function inside(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    )
      c = !c;
  }
  return c;
}

/** Metres from p to the edge of a ring. */
function edgeMetres(p, ring) {
  const k = kx(p[1]);
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const ax = (ring[i - 1][0] - p[0]) * k;
    const ay = (ring[i - 1][1] - p[1]) * KY;
    const bx = (ring[i][0] - p[0]) * k;
    const by = (ring[i][1] - p[1]) * KY;
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** The buildings, by grid cell of their box, for finding them fast. */
export function indexOf(buildings) {
  const cells = new Map();
  buildings.forEach((b, i) => {
    let w = Infinity,
      s = Infinity,
      e = -Infinity,
      n = -Infinity;
    for (const r of b.rings)
      for (const [x, y] of r) {
        w = Math.min(w, x);
        e = Math.max(e, x);
        s = Math.min(s, y);
        n = Math.max(n, y);
      }
    for (let cx = Math.floor(w / CELL); cx <= Math.floor(e / CELL); cx++)
      for (let cy = Math.floor(s / CELL); cy <= Math.floor(n / CELL); cy++) {
        const key = `${cx}:${cy}`;
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(i);
      }
  });
  return { buildings, cells };
}

/** The cadastre building of a point: the one holding it, else the nearest close by. */
export function buildingAt(index, p) {
  const cx = Math.floor(p[0] / CELL);
  const cy = Math.floor(p[1] / CELL);
  const seen = new Set();
  let near = null;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (const i of index.cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const b = index.buildings[i];
        if (b.rings.some((r) => inside(p, r))) return b;
        const m = Math.min(...b.rings.map((r) => edgeMetres(p, r)));
        if (m <= NEAR_M && (!near || m < near.m)) near = { b, m };
      }
  return near?.b ?? null;
}

/** One line of the cadastre's GeoJSON sequence → a building, or null. */
export function buildingOf(line) {
  const t = line.replace(/^\x1e/, '').trim();
  if (!t) return null;
  let f;
  try {
    f = JSON.parse(t);
  } catch {
    return null;
  }
  const rings = ringsOf(f.geometry);
  const fn =
    typeof f.properties?.funktion === 'string'
      ? f.properties.funktion.trim()
      : '';
  if (!rings.length || !fn) return null;
  const floors = Number.isInteger(f.properties?.anzahlgs)
    ? f.properties.anzahlgs
    : null;
  // The cadastre's own id of the building («DENW…»), else the number of
  // the line: the same within one build, which is all it is used for —
  // the pieces the map draws of one building (14 November 2026).
  const id =
    typeof f.properties?.oid === 'string' && f.properties.oid.trim()
      ? f.properties.oid.trim()
      : typeof f.id === 'string' || typeof f.id === 'number'
        ? String(f.id)
        : null;
  return { rings, fn, floors, id };
}

/** A CSV field: quoted when it must be. */
const csv = (v) =>
  v === null || v === undefined
    ? ''
    : /[",\n]/.test(String(v))
      ? `"${String(v).replace(/"/g, '""')}"`
      : String(v);

async function lines(file, each) {
  const rl = createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of rl) each(line);
}

/** One line of gebref.txt → its point and district key, or null. */
export function districtOf(line) {
  const f = line.split(';');
  if (f.length < 20) return null;
  const east = Number(f[18].replace(',', '.'));
  const north = Number(f[19].replace(',', '.'));
  if (!Number.isFinite(east) || !Number.isFinite(north)) return null;
  // Land «05», Regierungsbezirk «9», Kreis «11»: Bochum, file 05911000.
  const key = `${f[3].trim()}${f[5].trim()}${f[7].trim().padStart(2, '0')}`;
  if (!/^\d{5}$/.test(key)) return null;
  return { at: utm32ToLonLat(east, north), key };
}

async function districts(gebref, boxText) {
  const [w, s, e, n] = boxText.split(',').map(Number);
  const keys = new Set();
  await lines(gebref, (line) => {
    const d = districtOf(line);
    if (!d) return;
    const [lon, lat] = d.at;
    if (lon < w || lon > e || lat < s || lat > n) return;
    keys.add(d.key);
  });
  for (const k of [...keys].sort()) console.log(k);
}

async function match(housesFile, buildingsFile) {
  const buildings = [];
  await lines(buildingsFile, (line) => {
    const b = buildingOf(line);
    if (!b) return;
    b.id ??= `n${buildings.length + 1}`;
    buildings.push(b);
  });
  const index = indexOf(buildings);
  let houses = 0;
  let found = 0;
  await lines(housesFile, (line) => {
    const f = line.split(',');
    if (f.length < 4) return;
    const p = [Number(f[2]), Number(f[3])];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    houses += 1;
    const b = buildingAt(index, p);
    if (!b) return;
    found += 1;
    console.log(`${csv(f[1])},${csv(b.fn)},${csv(b.floors)},${csv(b.id)}`);
  });
  console.error(
    `official: ${buildings.length} cadastre buildings, ${found} of ${houses} houses found`,
  );
}

function selfTest() {
  // A square house 20 × 20 m and an L-shaped one whose middle is outside it.
  const m = (x, y) => [7 + x / kx(51.7), 51.7 + y / KY];
  const sq = {
    rings: [[m(0, 0), m(20, 0), m(20, 20), m(0, 20), m(0, 0)]],
    fn: 'Wohngebäude',
    floors: 2,
  };
  const ell = {
    rings: [
      [
        m(100, 0),
        m(130, 0),
        m(130, 10),
        m(110, 10),
        m(110, 30),
        m(100, 30),
        m(100, 0),
      ],
    ],
    fn: 'Gebäude für Wirtschaft oder Gewerbe',
    floors: 1,
  };
  const idx = indexOf([sq, ell]);
  const checks = [
    ['inside the square', buildingAt(idx, m(10, 10))?.fn, 'Wohngebäude'],
    [
      'the L, middle just off it',
      buildingAt(idx, m(113, 13))?.fn,
      'Gebäude für Wirtschaft oder Gewerbe',
    ],
    ['far from both: none', buildingAt(idx, m(60, 60)), null],
    [
      'a line read',
      buildingOf(
        JSON.stringify({
          type: 'Feature',
          properties: { funktion: 'Wohngebäude', anzahlgs: 3 },
          geometry: { type: 'Polygon', coordinates: sq.rings },
        }),
      )?.floors,
      3,
    ],
    [
      'a line without a function: none',
      buildingOf(
        JSON.stringify({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: sq.rings },
        }),
      ),
      null,
    ],
    [
      'a record separator is skipped',
      buildingOf(
        '\x1e' +
          JSON.stringify({
            type: 'Feature',
            properties: { funktion: 'Carport' },
            geometry: { type: 'Polygon', coordinates: sq.rings },
          }),
      )?.fn,
      'Carport',
    ],
    ['a comma quoted', csv('a, b'), '"a, b"'],
    [
      'the cadastre id read',
      buildingOf(
        JSON.stringify({
          type: 'Feature',
          properties: { funktion: 'Wohngebäude', oid: 'DENW36AL1000abc' },
          geometry: { type: 'Polygon', coordinates: sq.rings },
        }),
      )?.id,
      'DENW36AL1000abc',
    ],
    [
      'two pieces of one building: the same building',
      (() => {
        const i2 = indexOf([{ ...sq, id: 'X1' }]);
        return [buildingAt(i2, m(5, 5))?.id, buildingAt(i2, m(15, 15))?.id];
      })(),
      ['X1', 'X1'],
    ],
    [
      'the district of an address',
      districtOf(
        'N;DENW01HK10000a1o;A;05;Nordrhein-Westfalen;9;Arnsberg;11;Bochum;000;Bochum;0000;;04086;Obertor;50;;32;370279.838;5705335.366;2026-07-01',
      )?.key,
      '05911',
    ],
    ['a header is no address', districtOf('NBA;OI;QUA'), null],
  ];
  let bad = 0;
  for (const [name, got, want] of checks)
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      bad += 1;
      console.error(
        `✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
      );
    }
  console.log(
    `self-test: ${bad ? 'FAILED' : 'ok'} (${checks.length - bad}/${checks.length})`,
  );
  process.exit(bad ? 1 : 0);
}

async function main() {
  if (process.argv[2] === '--self-test') return selfTest();
  if (process.argv[2] === '--districts')
    return districts(process.argv[3], process.argv[4]);
  const [houses, buildings] = process.argv.slice(2);
  if (!houses || !buildings) {
    console.error('usage: map-official.mjs <houses.csv> <buildings.geojsonl>');
    process.exit(2);
  }
  return match(houses, buildings);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

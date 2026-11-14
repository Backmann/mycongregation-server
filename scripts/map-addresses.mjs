#!/usr/bin/env node
/**
 * Official addresses of North Rhine-Westphalia (14 November 2026, trial).
 *
 *   node scripts/map-addresses.mjs <gebref.txt> <west,south,east,north> <congregationId>
 *   node scripts/map-addresses.mjs --self-test
 *
 * Reads «Gebäudereferenzen NW» (Geobasis NRW, Datenlizenz Deutschland –
 * Zero 2.0): one line per main building with a house number, «;»-separated,
 * street name in field 15, number in 16, its letter in 17, ETRS89 / UTM 32
 * east and north in 19 and 20. Prints one CSV line per address inside the
 * box:
 *   congregation_id,lon,lat,number,street
 * The map file has a building's number but not its street; this is where
 * the street comes from, so a house goes to its own street, not merely the
 * nearest one.
 *
 * Public data only: an address and a point.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** ETRS89 / UTM zone 32 (east, north in metres) to longitude, latitude (Krüger series). */
export function utm32ToLonLat(east, north) {
  const a = 6378137;
  const f = 1 / 298.257222101; // GRS80
  const k0 = 0.9996;
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const beta = [
    n / 2 - (2 / 3) * n ** 2 + (37 / 96) * n ** 3,
    (1 / 48) * n ** 2 + (1 / 15) * n ** 3,
    (17 / 480) * n ** 3,
  ];
  const delta = [
    2 * n - (2 / 3) * n ** 2 - 2 * n ** 3,
    (7 / 3) * n ** 2 - (8 / 5) * n ** 3,
    (56 / 15) * n ** 3,
  ];
  const xi = north / (k0 * A);
  const eta = (east - 500000) / (k0 * A);
  let xi1 = xi;
  let eta1 = eta;
  for (let j = 1; j <= 3; j++) {
    xi1 -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += delta[j - 1] * Math.sin(2 * j * chi);
  const lambda0 = (9 * Math.PI) / 180; // zone 32
  const lambda = lambda0 + Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  return [(lambda * 180) / Math.PI, (phi * 180) / Math.PI];
}

/** One line of gebref.txt → an address, or null for a header or a broken line. */
export function addressOf(line) {
  const f = line.split(';');
  if (f.length < 20) return null;
  const street = f[14].trim();
  const hnr = f[15].trim();
  const adz = f[16].trim();
  const east = Number(f[18]);
  const north = Number(f[19]);
  if (!street || !/^\d+$/.test(hnr) || hnr === '0') return null;
  if (!Number.isFinite(east) || !Number.isFinite(north)) return null;
  const [lon, lat] = utm32ToLonLat(east, north);
  return { lon, lat, number: `${hnr}${adz.toLowerCase()}`, street };
}

const csv = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function selfTest() {
  // Reference points computed with PROJ (EPSG:25832 → EPSG:4326), the
  // corners of NRW and one in the middle; the series agrees to a few mm.
  const near = (x, y) => Math.abs(x - y) < 1e-7;
  const refs = [
    [300000, 5600000, 6.178688951328307, 50.51774074575428],
    [480000, 5800000, 8.706374164942916, 52.34992855838808],
    [520000, 5700000, 9.287822196510284, 51.45082894412842],
    [410000, 5730000, 7.697280346417524, 51.713708537698764],
  ];
  const ok = refs.every(([e, n, lon, lat]) => {
    const [x, y] = utm32ToLonLat(e, n);
    return near(x, lon) && near(y, lat);
  });
  const [lon, lat] = utm32ToLonLat(410000, 5730000);
  const a = addressOf(
    'N;DENW01AL0000abcd;A;05;NRW;5;Münster;15;Kreis;012;Gemeinde;0001;Ort;01234;Musterstraße;12;A;32;356593.000;5645450.000;2026-07-01',
  );
  const good = a && a.number === '12a' && a.street === 'Musterstraße';
  console.error(
    `self-test: ${ok && good ? 'ok' : 'FAILED'} (${lon.toFixed(5)}, ${lat.toFixed(5)})`,
  );
  process.exit(ok && good ? 0 : 1);
}

/** A CSV line with quoted fields ("" inside quotes). */
export function csvFields(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * How well the official addresses fit the map's houses and streets (the
 * trial on a pull request): how many houses with a number find their
 * address, how many addresses name a street the map has, and how often the
 * nearest street — today's guess — is not the address's own.
 */
async function compare(housesFile, streetsFile, addressesFile) {
  const { readFile } = await import('node:fs/promises');
  const rows = async (f) =>
    (await readFile(f, 'utf8')).split('\n').filter(Boolean).map(csvFields);
  const houses = (await rows(housesFile)).map((r) => ({
    at: [Number(r[2]), Number(r[3])],
    numbers: r[5] ? r[5].split(';') : [],
  }));
  const streets = (await rows(streetsFile)).map((r) => ({
    name: r[2],
    box: [4, 5, 6, 7].map((i) => Number(r[i])),
    lines: JSON.parse(r[8]),
  }));
  // About 200 m in degrees: a street further than that is not the nearest.
  const M = 0.003;
  const addresses = (await rows(addressesFile)).map((r) => ({
    at: [Number(r[1]), Number(r[2])],
    number: r[3],
    street: r[4],
  }));
  const k = [111320 * Math.cos((51 * Math.PI) / 180), 110540];
  const d = (p, q) => Math.hypot((p[0] - q[0]) * k[0], (p[1] - q[1]) * k[1]);
  const segD = (p, a, b) => {
    const ax = (a[0] - p[0]) * k[0];
    const ay = (a[1] - p[1]) * k[1];
    const bx = (b[0] - p[0]) * k[0];
    const by = (b[1] - p[1]) * k[1];
    const dx = bx - ax;
    const dy = by - ay;
    const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
  };
  const lineD = (p, lines) => {
    let m = Infinity;
    for (const l of lines)
      for (let j = 1; j < l.length; j++)
        m = Math.min(m, segD(p, l[j - 1], l[j]));
    return m;
  };
  // A grid of 100 m cells for the addresses.
  const cell = (p) =>
    `${Math.floor((p[0] * k[0]) / 100)}:${Math.floor((p[1] * k[1]) / 100)}`;
  const grid = new Map();
  for (const a of addresses) {
    const c = cell(a.at);
    grid.set(c, [...(grid.get(c) ?? []), a]);
  }
  const around = (p) => {
    const [x, y] = cell(p).split(':').map(Number);
    const out = [];
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        out.push(...(grid.get(`${x + i}:${y + j}`) ?? []));
    return out;
  };
  const names = new Set(streets.map((s) => s.name));
  let numbered = 0;
  let found = 0;
  let guessed = 0;
  let wrong = 0;
  for (const h of houses) {
    if (!h.numbers.length) continue;
    numbered += 1;
    const a = around(h.at).find(
      (x) => h.numbers.includes(x.number) && d(x.at, h.at) <= 40,
    );
    if (!a) continue;
    found += 1;
    if (!names.has(a.street)) continue;
    // Today's guess: the nearest named street.
    let best = null;
    let bestD = Infinity;
    for (const s of streets) {
      const [w, so, e, n] = s.box;
      if (
        h.at[0] < w - M ||
        h.at[0] > e + M ||
        h.at[1] < so - M ||
        h.at[1] > n + M
      )
        continue;
      const m = lineD(h.at, s.lines);
      if (m < bestD) {
        bestD = m;
        best = s.name;
      }
    }
    guessed += 1;
    if (best !== a.street) wrong += 1;
  }
  const named = addresses.filter((a) => names.has(a.street)).length;
  const pc = (x, y) => (y ? `${Math.round((x * 1000) / y) / 10}%` : '-');
  console.log(
    `houses with a number: ${numbered}; their address found: ${found} (${pc(found, numbered)})`,
  );
  console.log(
    `addresses: ${addresses.length}; their street on the map by name: ${named} (${pc(named, addresses.length)})`,
  );
  console.log(
    `nearest street is not the address's own: ${wrong} of ${guessed} (${pc(wrong, guessed)})`,
  );
}

async function main() {
  if (process.argv[2] === '--self-test') return selfTest();
  if (process.argv[2] === '--compare')
    return compare(...process.argv.slice(3, 6));
  const [file, boxText, congregationId] = process.argv.slice(2);
  if (!file || !boxText || !/^[0-9a-f-]{36}$/.test(congregationId ?? '')) {
    console.error(
      'usage: map-addresses.mjs <gebref.txt> <w,s,e,n> <congregation uuid>',
    );
    process.exit(2);
  }
  const [w, s, e, n] = boxText.split(',').map(Number);
  const lines = createInterface({ input: createReadStream(file, 'utf8') });
  let read = 0;
  let out = 0;
  for await (const line of lines) {
    read += 1;
    const a = addressOf(line);
    if (!a || a.lon < w || a.lon > e || a.lat < s || a.lat > n) continue;
    process.stdout.write(
      `${congregationId},${a.lon.toFixed(7)},${a.lat.toFixed(7)},${csv(a.number)},${csv(a.street)}\n`,
    );
    out += 1;
  }
  console.error(`${read} lines read, ${out} addresses in the box`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

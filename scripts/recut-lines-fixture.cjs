/**
 * Cases for the app's check of the editor's count (app/scripts/
 * check-recut-lines.mjs): the server's own cut (partsOfCut + partOf) of
 * invented territories by invented lines, and the part each point falls in.
 *
 *   npm run build && node scripts/recut-lines-fixture.cjs \
 *     > ../app/app/scripts/fixtures/recut-lines.json
 *
 * Seeded: the same cases each time, until the cut itself changes.
 */
const { partsOfCut, partOf } = require('../dist/src/territories/recut.js');
let seed = 20261116;
const rnd = () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const cases = [];
let refused = 0;
for (let n = 0; cases.length < 40 && n < 2000; n++) {
  const cx = 7 + rnd() * 2,
    cy = 51 + rnd();
  const k = 5 + Math.floor(rnd() * 9);
  const ring = [];
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2;
    const r = 0.004 + rnd() * 0.006; // concave by the random radius
    ring.push([r6(cx + Math.cos(a) * r * 1.6), r6(cy + Math.sin(a) * r)]);
  }
  ring.push(ring[0]);
  const g = { type: 'Polygon', coordinates: [ring] };
  const nl = 1 + Math.floor(rnd() * 3);
  const lines = [];
  for (let j = 0; j < nl; j++) {
    const a = rnd() * Math.PI;
    const ox = cx + (rnd() < 0.08 ? 0.05 : 0) + (rnd() - 0.5) * 0.008,
      oy = cy + (rnd() - 0.5) * 0.005;
    const pts = [];
    const m = 2 + Math.floor(rnd() * 3);
    for (let q = 0; q < m; q++) {
      const t = -0.02 + (q / (m - 1)) * 0.04;
      pts.push([
        r6(
          ox +
            Math.cos(a) * t +
            (q > 0 && q < m - 1 ? (rnd() - 0.5) * 0.002 : 0),
        ),
        r6(oy + Math.sin(a) * t * 0.6),
      ]);
    }
    lines.push(pts);
  }
  let parts;
  try {
    parts = partsOfCut(g, lines);
  } catch (e) {
    refused++;
    cases.push({ g, lines, refused: e.code ?? 'ERR', points: [] });
    continue;
  }
  const points = [];
  for (let i = 0; i < 100; i++) {
    const p = [r6(cx + (rnd() - 0.5) * 0.024), r6(cy + (rnd() - 0.5) * 0.014)];
    points.push([p, partOf(p, parts)]);
  }
  cases.push({ g, lines, parts: parts.length, points });
}
console.log(
  JSON.stringify({
    made: 'server recut.ts partsOfCut/partOf, 16 November 2026',
    cases,
  }),
);
console.error('cases', cases.length, 'refused', refused);

import type { TerritoryGeometry } from '../entities/territory.entity';
import {
  classOf,
  joinGroups,
  partOf,
  partsOfCut,
  verdictOf,
  DEFAULT_MEASURE,
} from './recut';
import { cutPlan } from './recut-lines';
import { driveGraph, minutesFrom, minutesInto, nearestOf } from './recut-drive';

type Pt = [number, number];
const poly = (pts: Pt[]) =>
  ({ type: 'Polygon', coordinates: [[...pts, pts[0]]] }) as TerritoryGeometry;
const box = (x0: number, y0: number, x1: number, y1: number) =>
  poly([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]);

/** Homes on a grid inside a box, but not inside `skip`. */
function grid(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step: number,
  skip?: (p: Pt) => boolean,
): Pt[] {
  const out: Pt[] = [];
  for (let x = x0 + step / 2; x < x1; x += step)
    for (let y = y0 + step / 2; y < y1; y += step) {
      const p: Pt = [x, y];
      if (!skip || !skip(p)) out.push(p);
    }
  return out;
}

describe('the draft of re-cutting: lines of a first proposal', () => {
  const T = box(7, 51, 7.03, 51.01);

  it('three parts of about even homes, read back the same by partsOfCut', () => {
    const homes = grid(7, 51, 7.03, 51.01, 0.001);
    const plan = cutPlan(T, homes, 3)!;
    expect(plan.lines).toHaveLength(2);
    const each = homes.length / 3;
    for (const n of plan.homes)
      expect(Math.abs(n - each) / each).toBeLessThan(0.15);
    // The editor and the apply read the lines with partsOfCut: same parts.
    const parts = partsOfCut(T, plan.lines);
    const counts = parts.map(() => 0);
    for (const h of homes) counts[partOf(h, parts)] += 1;
    expect(counts).toEqual(plan.homes);
  });

  it('the line goes along the empty field, not between rows of houses', () => {
    // Houses about 20–30 m apart west and east, a field of ≈600 m between:
    // a line across the rows divides as evenly, but cuts streets.
    const homes = grid(
      7,
      51,
      7.03,
      51.01,
      0.0003,
      ([x]) => x > 7.0105 && x < 7.0195,
    );
    const plan = cutPlan(T, homes, 2)!;
    const [[ax], [bx]] = plan.lines[0];
    // The whole line, both ends, inside the field: no house cut off from
    // its street.
    for (const x of [ax, bx]) {
      expect(x).toBeGreaterThan(7.0105);
      expect(x).toBeLessThan(7.0195);
    }
  });

  it('an L-shaped territory is still cut into whole pieces', () => {
    const L = poly([
      [7, 51],
      [7.03, 51],
      [7.03, 51.005],
      [7.01, 51.005],
      [7.01, 51.02],
      [7, 51.02],
    ]);
    const homes = grid(7, 51, 7.03, 51.02, 0.001).filter(
      (h) => partOf(h, [L]) === 0,
    );
    const plan = cutPlan(L, homes, 4)!;
    expect(plan).not.toBeNull();
    expect(partsOfCut(L, plan.lines)).toHaveLength(4);
  });
});

describe('the draft of re-cutting: what the measure says', () => {
  const m = DEFAULT_MEASURE;

  it('city or far: the keepers’ word first, else the minutes', () => {
    expect(classOf(10.5, undefined, m)).toBe('city');
    expect(classOf(11.9, undefined, m)).toBe('far');
    expect(classOf(null, undefined, m)).toBe('city');
    expect(classOf(15, 'city', m)).toBe('city');
  });

  it('cut, join or keep', () => {
    expect(verdictOf(41, 'city', m)).toEqual({
      action: 'cut',
      parts: 3,
      partKm: 41 / 3,
    });
    // 28 km is fine far out, too long in the city.
    expect(verdictOf(28, 'far', m)).toEqual({ action: 'keep' });
    expect(verdictOf(28, 'city', m).action).toBe('cut');
    expect(verdictOf(75, 'far', m)).toMatchObject({ action: 'cut', parts: 4 });
    expect(verdictOf(3, 'city', m)).toEqual({ action: 'merge' });
  });

  it('small neighbours are joined from the smallest up, within the target', () => {
    // A row: 32 — 33 — 34 — 35 (a large one).
    const row = ['32', '33', '34', '35'];
    const touches = (a: string, b: string) =>
      Math.abs(row.indexOf(a) - row.indexOf(b)) === 1;
    const groups = joinGroups(
      [
        { id: '32', walkKm: 2.9, small: true, target: 15 },
        { id: '33', walkKm: 3.6, small: true, target: 15 },
        { id: '34', walkKm: 2.7, small: true, target: 15 },
        { id: '35', walkKm: 14, small: false, target: 15 },
      ],
      touches,
    );
    expect(groups.map((g) => [...g].sort())).toEqual([['32', '33', '34']]);
  });

  it('a small one alone with no room beside it stays as it is', () => {
    expect(
      joinGroups(
        [
          { id: 'a', walkKm: 3, small: true, target: 15 },
          { id: 'b', walkKm: 14, small: false, target: 15 },
        ],
        () => true,
      ),
    ).toEqual([]);
  });
});

describe('the draft of re-cutting: minutes by car', () => {
  // A main road east–west and a side street north from its middle.
  const roads = [
    {
      kind: 'major_road',
      lines: [
        [
          [7.0, 51.0],
          [7.1, 51.0],
        ],
      ] as Pt[][],
    },
    {
      kind: 'minor_road',
      lines: [
        [
          // Its end stops 20 m short of the main road: a crossing thinned away.
          [7.05, 51.00018],
          [7.05, 51.02],
        ],
      ] as Pt[][],
    },
    {
      kind: 'path',
      lines: [
        [
          [7.0, 51.0],
          [7.05, 51.02],
        ],
      ] as Pt[][],
    },
  ];
  const g = driveGraph(roads);

  it('the side street is reached through the crossing, by road speeds, not along the path', () => {
    const t = minutesFrom(g, nearestOf(g, [7.0, 51.0])!);
    const end = nearestOf(g, [7.05, 51.02])!;
    // ≈3.5 km at 50 km/h + ≈2.2 km at 30 km/h ≈ 4.2 + 4.4 minutes.
    expect(t[end]).toBeGreaterThan(7.5);
    expect(t[end]).toBeLessThan(10);
  });

  it('minutes into a territory: the middle of its roads, not its nearest corner', () => {
    const t = minutesFrom(g, nearestOf(g, [7.0, 51.0])!);
    const strip = box(7.045, 51.001, 7.055, 51.021);
    const m = minutesInto(g, t, strip)!;
    expect(m).toBeGreaterThan(5.5);
    expect(m).toBeLessThan(7.5);
    expect(minutesInto(g, t, box(8, 52, 8.01, 52.01))).toBeNull();
  });
});

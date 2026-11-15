import type { TerritoryGeometry } from '../entities/territory.entity';
import {
  DEFAULT_MEASURE,
  joinAll,
  measureProblem,
  movedShare,
  partOf,
  partsOfCut,
} from './recut';

const box = (x0: number, y0: number, x1: number, y1: number) =>
  ({
    type: 'Polygon',
    coordinates: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ],
  }) as TerritoryGeometry;

/** A 2 × 1 km block (roughly), at 51° N. */
const T = box(7, 51, 7.03, 51.009);
const vertical = (x: number): [number, number][] => [
  [x, 50.99],
  [x, 51.02],
];
const horizontal = (y: number, x0 = 6.99, x1 = 7.04): [number, number][] => [
  [x0, y],
  [x1, y],
];

describe('the draft of re-cutting: cutting into parts', () => {
  it('two lines across make three parts, in the order of the lines', () => {
    const parts = partsOfCut(T, [vertical(7.01), vertical(7.02)]);
    expect(parts).toHaveLength(3);
    expect(partOf([7.005, 51.004], parts)).toBe(0);
    expect(partOf([7.025, 51.004], parts)).toBe(2);
    expect(partOf([7.015, 51.004], parts)).not.toBe(-1);
  });

  it('a second line may cut a part the first line made', () => {
    const parts = partsOfCut(T, [
      vertical(7.015),
      // Drawn up to the first line, as a hand draws it.
      horizontal(51.0045, 7.015, 7.04),
    ]);
    expect(parts).toHaveLength(3);
    // The left part stays whole; the right one is cut in two.
    expect(partOf([7.005, 51.002], parts)).toBe(partOf([7.005, 51.007], parts));
    expect(partOf([7.025, 51.002], parts)).not.toBe(
      partOf([7.025, 51.007], parts),
    );
  });

  it('a line that wanders through its part twice is refused', () => {
    const zigzag: [number, number][] = [
      [7.005, 50.99],
      [7.005, 51.02],
      [7.008, 51.02],
      [7.008, 50.99],
    ];
    expect(() => partsOfCut(T, [zigzag])).toThrow();
  });

  it('a line beside the territory is refused', () => {
    expect(() => partsOfCut(T, [vertical(7.2)])).toThrow(/edge to edge/);
  });

  it('no lines, or too many, are refused', () => {
    expect(() => partsOfCut(T, [])).toThrow();
    const many = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => vertical(7 + k * 0.003));
    expect(() => partsOfCut(T, many)).toThrow();
  });
});

describe('the draft of re-cutting: joining neighbours', () => {
  const a = box(7, 51, 7.01, 51.009);
  const b = box(7.01, 51, 7.02, 51.009);
  const c = box(7.02, 51, 7.03, 51.009);

  it('three in a row join, in any order', () => {
    const whole = joinAll([a, c, b]);
    for (const p of [
      [7.005, 51.004],
      [7.015, 51.004],
      [7.025, 51.004],
    ] as [number, number][])
      expect(partOf(p, [whole])).toBe(0);
  });

  it('one that touches none of them is refused', () => {
    expect(() => joinAll([a, box(7.2, 51, 7.21, 51.009)])).toThrow(
      /do not all touch/,
    );
  });
});

describe('the draft of re-cutting: how much a redrawn cut moves', () => {
  const homes: [number, number][] = [];
  for (let i = 0; i < 30; i++) homes.push([7.0005 + i * 0.001, 51.004]);

  it('the same lines move nothing; a line moved by a third of a part moves its homes', () => {
    const before = partsOfCut(T, [vertical(7.01), vertical(7.02)]);
    expect(movedShare(before, before, homes)).toBe(0);
    const after = partsOfCut(T, [vertical(7.013), vertical(7.02)]);
    const share = movedShare(before, after, homes);
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.12);
  });

  it('a different number of parts is a different proposal', () => {
    const before = partsOfCut(T, [vertical(7.01)]);
    const after = partsOfCut(T, [vertical(7.01), vertical(7.02)]);
    expect(movedShare(before, after, homes)).toBe(1);
  });
});

describe('the measure', () => {
  it('the agreed one holds together', () => {
    expect(measureProblem(DEFAULT_MEASURE)).toBeNull();
  });

  it('a part above its maximum, or a nonsense value, is refused', () => {
    expect(
      measureProblem({ ...DEFAULT_MEASURE, cityTargetKm: 30 }),
    ).not.toBeNull();
    expect(measureProblem({ ...DEFAULT_MEASURE, minKm: -1 })).not.toBeNull();
    expect(measureProblem({ ...DEFAULT_MEASURE, minKm: 20 })).not.toBeNull();
  });
});

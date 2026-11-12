import {
  checkGeometry,
  cutByBorder,
  GeometryError,
  overlaps,
  shareOutside,
  areaShareOutside,
} from './geometry';
import { keptFrom, serviceYearOf } from './service-year';

/** A square of `size` degrees with its lower-left corner at (x, y). */
const square = (x: number, y: number, size = 0.01) =>
  checkGeometry({
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
        [x, y],
      ],
    ],
  });

describe('territory outlines', () => {
  it('closes an open ring and rounds to six decimals', () => {
    const g = checkGeometry({
      type: 'Polygon',
      coordinates: [
        [
          [7.1234567, 51.1],
          [7.2, 51.1],
          [7.2, 51.2],
        ],
      ].map((r) => [...r, [7.1, 51.2]]),
    });
    const ring = g.coordinates[0] as number[][];
    expect(ring[0]).toEqual([7.123457, 51.1]);
    expect(ring.at(-1)).toEqual(ring[0]);
  });

  it('refuses what is not an area', () => {
    expect(() =>
      checkGeometry({ type: 'Point', coordinates: [7, 51] }),
    ).toThrow(GeometryError);
    expect(() =>
      checkGeometry({
        type: 'Polygon',
        coordinates: [
          [
            [7, 51],
            [8, 51],
          ],
        ],
      }),
    ).toThrow(GeometryError);
    expect(() =>
      checkGeometry({
        type: 'Polygon',
        coordinates: [
          [
            [7, 51],
            [500, 51],
            [7, 52],
            [7, 51],
          ],
        ],
      }),
    ).toThrow(/off the map/);
  });

  it('neighbours sharing a border do not overlap', () => {
    // A hand-drawn shared border is never exact: the right square starts a
    // metre into the left one.
    const left = square(7, 51);
    const right = square(7.01 - 0.00001, 51);
    expect(overlaps(left, right)).toBe(false);
  });

  it('squares laid over each other do', () => {
    expect(overlaps(square(7, 51), square(7.005, 51.005))).toBe(true);
  });

  it('a territory inside the boundary is not outside; one across it is', () => {
    const area = square(7, 51, 0.1);
    expect(shareOutside(square(7.02, 51.02), area)).toBe(0);
    expect(shareOutside(square(7.095, 51.02), area)).toBeGreaterThan(0);
  });

  it('a territory poking out between its own corners is caught', () => {
    // The boundary's corner pokes into a long thin territory whose four
    // corners all lie inside the boundary.
    const area = checkGeometry({
      type: 'Polygon',
      coordinates: [
        [
          [7, 51],
          [7.1, 51],
          [7.1, 51.029],
          [7.05, 51.03],
          [7.1, 51.031],
          [7.1, 51.1],
          [7, 51.1],
          [7, 51],
        ],
      ],
    });
    const strip = checkGeometry({
      type: 'Polygon',
      coordinates: [
        [
          [7.04, 51.02],
          [7.06, 51.02],
          [7.06, 51.04],
          [7.04, 51.04],
          [7.04, 51.02],
        ],
      ],
    });
    expect(shareOutside(strip, area)).toBe(0);
    expect(cutByBorder(strip, area)).toBe(true);
    // ...and its ground outside is measured: the notch is a sliver.
    const share = areaShareOutside(strip, area);
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(0.03);
  });

  it('measures the ground outside, not the corners (12 November 2026)', () => {
    const area = square(7, 51, 0.1);
    // Half of a square across the border: half its ground.
    expect(areaShareOutside(square(7.095, 51.02), area)).toBeCloseTo(0.5, 1);
    // Wholly inside: nothing, and no measuring needed.
    expect(areaShareOutside(square(7.02, 51.02), area)).toBe(0);
    // A territory drawn with a ragged edge a hair past the border: most of
    // its corners lie outside, almost none of its ground does.
    const ragged = checkGeometry({
      type: 'Polygon',
      coordinates: [
        [
          [7.08, 51.02],
          [7.1001, 51.02],
          [7.0999, 51.022],
          [7.1001, 51.024],
          [7.0999, 51.026],
          [7.1001, 51.028],
          [7.0999, 51.029],
          [7.1001, 51.03],
          [7.08, 51.03],
          [7.08, 51.02],
        ],
      ],
    });
    expect(shareOutside(ragged, area)).toBeGreaterThan(0.4);
    expect(areaShareOutside(ragged, area)).toBeLessThan(0.01);
  });
});

describe('service years', () => {
  it('runs September to August and is named by its end', () => {
    expect(serviceYearOf('2026-08-31')).toBe(2026);
    expect(serviceYearOf('2026-09-01')).toBe(2027);
  });

  it('keeps the current and the previous service year', () => {
    expect(keptFrom('2026-11-11')).toBe('2025-09-01');
    expect(keptFrom('2026-08-31')).toBe('2024-09-01');
  });
});

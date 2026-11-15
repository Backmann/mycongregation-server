// A switch over the real library: off, it works as always.
const fail = { intersection: false, union: false };
jest.mock('polygon-clipping', () => {
  const real =
    jest.requireActual<typeof import('polygon-clipping')>('polygon-clipping');
  const gaveUp = () => {
    throw new Error('Unable to complete output ring starting at [7, 51].');
  };
  return {
    ...real,
    intersection: (...a: Parameters<typeof real.intersection>) =>
      fail.intersection ? gaveUp() : real.intersection(...a),
    union: (...a: Parameters<typeof real.union>) =>
      fail.union ? gaveUp() : real.union(...a),
  };
});
import type { TerritoryGeometry } from '../entities/territory.entity';
import { cutPlan } from './recut-lines';
import { joinTwo, ReshapeError, splitByLine } from './reshape';

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

/**
 * The clipping library gives up on some outlines (15 November 2026: «Unable
 * to complete output ring» made «Предложить по мерке» a 500 for the whole
 * draft). Its failure is a refusal of one line or join, never a crash.
 */
describe('when the clipping gives up', () => {
  const T = box(7, 51, 7.03, 51.01);
  afterEach(() => {
    fail.intersection = false;
    fail.union = false;
  });

  it('the switch off: the same cut and join go through', () => {
    expect(
      splitByLine(T, [
        [7.015, 50.99],
        [7.015, 51.02],
      ]),
    ).toHaveLength(2);
    expect(joinTwo(T, box(7.03, 51, 7.06, 51.01)).type).toBe('Polygon');
  });

  it('a cut is refused as a line to draw again', () => {
    fail.intersection = true;
    let e: unknown;
    try {
      splitByLine(T, [
        [7.015, 50.99],
        [7.015, 51.02],
      ]);
    } catch (x) {
      e = x;
    }
    expect(e).toBeInstanceOf(ReshapeError);
    expect((e as ReshapeError).code).toBe('SPLIT_FAILED');
  });

  it('a join is refused, not crashed', () => {
    fail.union = true;
    let e: unknown;
    try {
      joinTwo(T, box(7.03, 51, 7.06, 51.01));
    } catch (x) {
      e = x;
    }
    expect(e).toBeInstanceOf(ReshapeError);
    expect((e as ReshapeError).code).toBe('JOIN_FAILED');
  });

  it('the first draft leaves such a territory to the hand instead of failing', () => {
    fail.intersection = true;
    const homes: [number, number][] = [];
    for (let x = 7.0005; x < 7.03; x += 0.001)
      for (let y = 51.0005; y < 51.01; y += 0.001) homes.push([x, y]);
    expect(cutPlan(T, homes, 2)).toBeNull();
  });
});

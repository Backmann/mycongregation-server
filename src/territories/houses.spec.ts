import { checkGeometry } from './geometry';
import { boxAround, houseShift, type HousePoint } from './houses';

const rect = (x1: number, x2: number) =>
  checkGeometry({
    type: 'Polygon',
    coordinates: [
      [
        [x1, 51],
        [x2, 51],
        [x2, 51.01],
        [x1, 51.01],
        [x1, 51],
      ],
    ],
  });

describe('houses changing hands (12 November 2026)', () => {
  const houses: HousePoint[] = [
    [7.0102, 51.005], // in the strip that moves
    [7.015, 51.005],
    [7.018, 51.002],
    [7.005, 51.005], // the neighbour's
    [7.03, 51.005], // nobody's
  ];

  it('counts those before, leaving and coming', () => {
    expect(houseShift(rect(7.01, 7.02), rect(7.012, 7.02), houses)).toEqual({
      before: 3,
      leaving: 1,
      coming: 0,
    });
    expect(houseShift(rect(7, 7.01), rect(7, 7.012), houses)).toEqual({
      before: 1,
      leaving: 0,
      coming: 1,
    });
  });

  it('nothing moves when the outline is the same', () => {
    expect(houseShift(rect(7.01, 7.02), rect(7.01, 7.02), houses)).toEqual({
      before: 3,
      leaving: 0,
      coming: 0,
    });
  });

  it('one box round several outlines', () => {
    expect(boxAround([rect(7, 7.01), rect(7.012, 7.02)])).toEqual([
      7, 51, 7.02, 51.01,
    ]);
  });
});

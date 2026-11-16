import type { TerritoryGeometry } from '../entities/territory.entity';
import { joinStanding, oldestWorked, placeNoCalls } from './recut-apply';

const square = (x0: number, x1: number): TerritoryGeometry => ({
  type: 'Polygon',
  coordinates: [
    [
      [x0, 0],
      [x1, 0],
      [x1, 1],
      [x0, 1],
      [x0, 0],
    ],
  ],
});

describe('placeNoCalls', () => {
  const parts = [square(0, 1), square(1, 2)];
  const addresses = [
    { at: [0.5, 0.5] as [number, number], street: 'Sedanstraße', number: '6' },
    {
      at: [1.5, 0.5] as [number, number],
      street: 'Sedanstraße',
      number: '12a',
    },
    // The same street and number in two places, in two parts.
    { at: [0.2, 0.2] as [number, number], street: 'Kirchweg', number: '1' },
    { at: [1.8, 0.8] as [number, number], street: 'Kirchweg', number: '1' },
    // Outside every part.
    { at: [5, 5] as [number, number], street: 'Feldweg', number: '3' },
  ];

  it('puts an address in the part its official address lies in', () => {
    expect(
      placeNoCalls(
        [
          { id: 'a', address: 'Sedanstr. 6, 59065 Hamm' },
          { id: 'b', address: 'Sedanstraße 12 a' },
        ],
        parts,
        addresses,
      ),
    ).toEqual([
      { id: 'a', part: 0 },
      { id: 'b', part: 1 },
    ]);
  });

  it('leaves it to the keeper when not found, found twice, or outside', () => {
    expect(
      placeNoCalls(
        [
          { id: 'x', address: 'Unbekannter Weg 4' },
          { id: 'y', address: 'Kirchweg 1' },
          { id: 'z', address: 'Feldweg 3' },
          { id: 'w', address: 'ohne Nummer' },
        ],
        parts,
        addresses,
      ),
    ).toEqual([
      { id: 'x', part: null },
      { id: 'y', part: null },
      { id: 'z', part: null },
      { id: 'w', part: null },
    ]);
  });
});

describe('oldestWorked', () => {
  it('is the oldest day; never worked if any was never worked', () => {
    expect(oldestWorked(['2026-09-03', '2026-05-01', '2026-10-10'])).toBe(
      '2026-05-01',
    );
    expect(oldestWorked(['2026-09-03', null])).toBeNull();
  });
});

describe('joinStanding', () => {
  it('counts the free ones and names those still out', () => {
    expect(
      joinStanding([
        { id: '1', number: 'A', heldSince: null },
        { id: '2', number: 'B', heldSince: '2026-10-01' },
        { id: '3', number: 'C', heldSince: null },
      ]),
    ).toEqual({
      free: 2,
      total: 3,
      waiting: [{ number: 'B', since: '2026-10-01' }],
    });
  });
});

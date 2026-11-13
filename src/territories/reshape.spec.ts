import { checkGeometry } from './geometry';
import {
  areaM2,
  joinTwo,
  nextNumber,
  businessPattern,
  ReshapeError,
  splitByLine,
} from './reshape';

const rect = (x1: number, x2: number, y1 = 51, y2 = 51.01) =>
  checkGeometry({
    type: 'Polygon',
    coordinates: [
      [
        [x1, y1],
        [x2, y1],
        [x2, y2],
        [x1, y2],
        [x1, y1],
      ],
    ],
  });

const codeOf = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as ReshapeError).code;
  }
  return null;
};

describe('cutting and joining territories (12 November 2026)', () => {
  const whole = rect(7, 7.02);

  it('a straight line across cuts it in two that add up to it', () => {
    const [a, b] = splitByLine(whole, [
      [7.012, 50.99],
      [7.012, 51.02],
    ]);
    const total = areaM2(whole);
    expect(Math.round(((areaM2(a) + areaM2(b)) / total) * 1000)).toBe(1000);
    const shares = [areaM2(a), areaM2(b)].map((x) =>
      Math.round((x / total) * 10),
    );
    expect(shares.sort()).toEqual([4, 6]);
  });

  it('a bent line inside the territory works too, its ends carried out', () => {
    const [a, b] = splitByLine(whole, [
      [7.005, 51.0001],
      [7.01, 51.005],
      [7.015, 51.0099],
    ]);
    expect(areaM2(a) + areaM2(b)).toBeCloseTo(areaM2(whole), -1);
  });

  it('a line beside the territory, a short one, a knotted one are refused', () => {
    expect(
      codeOf(() =>
        splitByLine(whole, [
          [7.05, 50.99],
          [7.05, 51.02],
        ]),
      ),
    ).toBe('LINE_NOT_THROUGH');
    expect(codeOf(() => splitByLine(whole, [[7.01, 51.005]]))).toBe(
      'LINE_SHORT',
    );
    expect(
      codeOf(() =>
        splitByLine(whole, [
          [7.002, 50.99],
          [7.008, 51.02],
          [7.008, 51.0],
          [7.002, 51.02],
        ]),
      ),
    ).toBe('LINE_CROSSES_ITSELF');
  });

  it('a line through it twice would leave three pieces: refused', () => {
    expect(
      codeOf(() =>
        splitByLine(whole, [
          [6.99, 51.002],
          [7.01, 51.002],
          [7.01, 51.02],
          [7.015, 51.02],
          [7.015, 51.002],
          [7.03, 51.002],
        ]),
      ),
    ).toBe('LINE_MANY_PIECES');
  });

  it('two neighbours join into one; a hair between them does not matter', () => {
    const j = joinTwo(rect(7, 7.01), rect(7.01, 7.02));
    expect(j.type).toBe('Polygon');
    expect(areaM2(j)).toBeCloseTo(areaM2(whole), -1);
    // Ten centimetres apart along the border: still one.
    const hair = joinTwo(rect(7, 7.01), rect(7.0100015, 7.02));
    expect(hair.type).toBe('Polygon');
    expect((hair.coordinates as number[][][]).length).toBe(1);
  });

  it('two apart are not joined; one ring round another would leave a hole', () => {
    expect(codeOf(() => joinTwo(rect(7, 7.01), rect(7.03, 7.04)))).toBe(
      'NOT_TOUCHING',
    );
    const ring = checkGeometry({
      type: 'Polygon',
      coordinates: [
        [
          [7, 51],
          [7.03, 51],
          [7.03, 51.03],
          [7, 51.03],
          [7, 51],
        ],
        [
          [7.01, 51.01],
          [7.02, 51.01],
          [7.02, 51.02],
          [7.01, 51.02],
          [7.01, 51.01],
        ],
      ],
    });
    const corner = rect(7.03, 7.04, 51, 51.01);
    expect(codeOf(() => joinTwo(ring, corner))).toBe('SHAPE_WITH_HOLE');
  });

  it('the next number keeps the prefix and the width of the digits', () => {
    const taken = ['Hamm01', 'Hamm42', 'Hamm73', 'Ahlen07', 'Ahlen13', 'Д-1'];
    expect(nextNumber('Hamm42', taken)).toBe('Hamm74');
    expect(nextNumber('Ahlen07', taken)).toBe('Ahlen14');
    expect(nextNumber('Д-1', taken)).toBe('Д-2');
    expect(nextNumber('Dinker', ['Dinker'])).toBe('Dinker-2');
    expect(nextNumber('Dinker', ['Dinker', 'Dinker-2'])).toBe('Dinker-3');
  });
});

describe('the first business territory is numbered in its language (13 November 2026)', () => {
  it('Д-1 in Russian, G-1 in German, B-1 elsewhere', () => {
    expect(nextNumber(businessPattern('ru'), [])).toBe('Д-1');
    expect(nextNumber(businessPattern('de'), ['Hamm01'])).toBe('G-1');
    expect(nextNumber(businessPattern('de-DE'), [])).toBe('G-1');
    expect(nextNumber(businessPattern('en'), [])).toBe('B-1');
    expect(nextNumber(businessPattern(null), [])).toBe('B-1');
    expect(nextNumber(businessPattern('ru'), ['Д-1', 'Д-2'])).toBe('Д-3');
  });
});

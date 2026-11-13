import {
  partsOfAddress,
  splitStreets,
  streetKey,
  streetsWithHouses,
  unevenness,
  type House,
  type PlanStreet,
  type Pt,
} from './split';

// At 51° N: 0.0009° north ≈ 100 m, 0.0014° east ≈ 100 m.
const house = (id: string | number, x: number, y: number): House => ({
  id: String(id),
  at: [x, y],
});
const street = (name: string, houses: number, at: Pt): PlanStreet => ({
  key: name,
  name,
  from: null,
  to: null,
  piece: 1,
  pieces: 1,
  houses,
  homes: [],
  at,
  lines: [],
});

describe('dividing a territory between groups (13 November 2026)', () => {
  const A = {
    name: 'Ahornweg',
    lines: [
      [
        [7.0, 51.0],
        [7.003, 51.0],
      ] as Pt[],
    ],
  };
  const B = {
    name: 'Birkenweg',
    lines: [
      [
        [7.0, 51.0009],
        [7.003, 51.0009],
      ] as Pt[],
    ],
  };

  it('gives each house to its nearest named street and leaves far barns out', () => {
    const r = streetsWithHouses(
      [
        A,
        B,
        {
          name: ' ',
          lines: [
            [
              [7, 51],
              [7.1, 51],
            ],
          ],
        },
      ],
      [
        house(1, 7.001, 51.0001),
        house(2, 7.002, 51.0001),
        house(3, 7.001, 51.0008),
        house(4, 7.001, 51.01),
      ],
    );
    expect(r.streets.map((s) => [s.name, s.houses, s.homes])).toEqual([
      ['Ahornweg', 2, ['1', '2']],
      ['Birkenweg', 1, ['3']],
    ]);
    expect(r.left).toBe(1);
  });

  it('takes a street drawn in pieces as one, and drops streets nobody lives on', () => {
    const r = streetsWithHouses(
      [
        A,
        {
          name: 'Ahornweg',
          lines: [
            [
              [7.003, 51.0],
              [7.006, 51.0],
            ],
          ],
        },
        B,
      ],
      [house(1, 7.005, 51.0001)],
    );
    expect(r.streets.map((s) => [s.key, s.houses])).toEqual([['Ahornweg', 1]]);
  });

  describe('a long street', () => {
    // 1.2 km east, 40 houses along it, crossed by two side streets at the
    // places where it is cut (a third and two thirds along).
    const long = {
      name: 'Landstraße',
      lines: [
        [
          [7.0, 51.0],
          [7.018, 51.0],
        ],
      ] as Pt[][],
    };
    const along = Array.from({ length: 40 }, (_, i) =>
      house(i, 7.0 + (i * 0.0171) / 39, 51.0002),
    );
    // The side streets end at the long one, on the far side from its houses.
    const cross1 = {
      name: 'Erlenweg',
      lines: [
        [
          [7.0057, 50.999],
          [7.0057, 50.99995],
        ],
      ] as Pt[][],
    };
    const cross2 = {
      name: 'Lindenweg',
      lines: [
        [
          [7.0115, 50.999],
          [7.0115, 50.99995],
        ],
      ] as Pt[][],
    };

    it('is walked in pieces of about equal houses, west first, named by the crossing streets', () => {
      const r = streetsWithHouses([long, cross1, cross2], along);
      expect(
        r.streets.map((s) => [
          s.key,
          s.houses,
          s.from,
          s.to,
          s.piece,
          s.pieces,
        ]),
      ).toEqual([
        ['Landstraße#1', 13, null, 'Erlenweg', 1, 3],
        ['Landstraße#2', 14, 'Erlenweg', 'Lindenweg', 2, 3],
        ['Landstraße#3', 13, 'Lindenweg', null, 3, 3],
      ]);
      expect(r.streets[0].homes.slice(0, 3)).toEqual(['0', '1', '2']);
    });

    it('has no name for a cut where no street crosses', () => {
      const r = streetsWithHouses([long], along);
      expect(r.streets.map((s) => [s.from, s.to])).toEqual([
        [null, null],
        [null, null],
        [null, null],
      ]);
    });

    it('draws each piece only where its houses are', () => {
      const r = streetsWithHouses([long], along);
      const east = r.streets[0].lines.flat().map((p) => p[0]);
      // The whole street runs to 7.018; the first piece stops near its last house.
      expect(Math.max(...east)).toBeLessThan(7.0065);
      expect(r.streets[0].lines.length).toBeGreaterThan(0);
    });

    it('stays whole when short', () => {
      const r = streetsWithHouses(
        [A],
        [house(1, 7.001, 51.0001), house(2, 7.002, 51.0001)],
      );
      expect(r.streets.map((s) => [s.key, s.pieces])).toEqual([
        ['Ahornweg', 1],
      ]);
    });
  });

  describe('the parts', () => {
    const row = Array.from({ length: 8 }, (_, i) =>
      street(`S${i}`, 10, [7 + i * 0.002, 51]),
    );

    it('are even and keep neighbours together', () => {
      const four = splitStreets(row, 4);
      expect(four.map((p) => p.houses)).toEqual([20, 20, 20, 20]);
      expect(four.map((p) => p.streets.map((s) => s.key))).toEqual([
        ['S0', 'S1'],
        ['S2', 'S3'],
        ['S4', 'S5'],
        ['S6', 'S7'],
      ]);
      expect(four.map((p) => p.n)).toEqual([1, 2, 3, 4]);
    });

    it('come north first when the territory is cut across', () => {
      const column = Array.from({ length: 4 }, (_, i) =>
        street(`N${i}`, 10, [7, 51 + i * 0.002]),
      );
      expect(
        splitStreets(column, 2).map((p) => p.streets.map((s) => s.key)),
      ).toEqual([
        ['N2', 'N3'],
        ['N0', 'N1'],
      ]);
    });

    it('even out a heavy street: 20 / 20, not 30 / 10', () => {
      const two = splitStreets(
        [
          street('Lang', 20, [7.0, 51]),
          street('K1', 10, [7.001, 51]),
          street('K2', 5, [7.002, 51]),
          street('K3', 5, [7.003, 51]),
        ],
        2,
      );
      expect(two.map((p) => p.houses).sort()).toEqual([20, 20]);
      expect(unevenness(two)).toBe(1);
    });

    it('come within a third of each other on a real town territory', () => {
      // Houses per street and where they are, from the map (names left out):
      // two long streets of 125–140 buildings. Cutting along one side alone
      // gave 260/202/142.
      const town = (
        [
          [30, 7.8241, 51.71028],
          [140, 7.81966, 51.70763],
          [9, 7.82634, 51.70753],
          [3, 7.82729, 51.70696],
          [10, 7.82453, 51.70795],
          [10, 7.82571, 51.70847],
          [125, 7.8175, 51.70843],
          [11, 7.82307, 51.70987],
          [24, 7.82157, 51.71046],
          [51, 7.81268, 51.70678],
          [19, 7.81163, 51.70823],
          [31, 7.81936, 51.71007],
          [6, 7.81148, 51.71222],
          [46, 7.81621, 51.71024],
          [13, 7.81754, 51.70898],
          [18, 7.81762, 51.70964],
          [4, 7.81745, 51.71011],
          [8, 7.81991, 51.70942],
          [8, 7.81996, 51.70995],
          [29, 7.82109, 51.70948],
          [9, 7.81569, 51.7123],
        ] as [number, number, number][]
      ).map(([h, x, y], i) => street(`T${i}`, h, [x, y]));
      const three = splitStreets(town, 3);
      expect(unevenness(three)).toBeLessThan(1.3);
      expect(three.reduce((a, p) => a + p.houses, 0)).toBe(
        town.reduce((a, s) => a + s.houses, 0),
      );
    });

    it('is everything in one when one part is asked for', () => {
      expect(splitStreets(row, 1).map((p) => p.houses)).toEqual([80]);
    });

    it('lead the route to a street in the middle of the part', () => {
      const [p] = splitStreets(row.slice(0, 3), 1);
      expect(p.start).toEqual([7.002, 51]);
    });
  });

  describe('«не посещать» addresses', () => {
    it('compare an address with a street name', () => {
      expect(streetKey('Schleusenstr. 8')).toBe(streetKey('Schleusenstraße'));
      expect(streetKey('Alter Uentroper Weg 12a')).toBe(
        streetKey('Alter Uentroper Weg'),
      );
      expect(streetKey('Sankt-Georgs-Platz 3')).toBe(
        streetKey('Sankt Georgs Platz'),
      );
      expect(streetKey('Ostring 4')).not.toBe(streetKey('Oststraße'));
    });

    it('go to every part that walks their street', () => {
      const parts = splitStreets(
        [
          street('Ahornweg', 10, [7.0, 51]),
          street('Birkenweg', 10, [7.01, 51]),
        ],
        2,
      );
      expect(partsOfAddress(parts, 'Birkenweg 4')).toEqual([2]);
      expect(partsOfAddress(parts, 'Kastanienallee 1')).toEqual([]);
      const pieces = [
        { ...street('Lang', 10, [7.0, 51] as Pt), key: 'Lang#1' },
        { ...street('Lang', 10, [7.01, 51] as Pt), key: 'Lang#2' },
      ];
      expect(partsOfAddress(splitStreets(pieces, 2), 'Lang 3')).toEqual([1, 2]);
    });
  });
});

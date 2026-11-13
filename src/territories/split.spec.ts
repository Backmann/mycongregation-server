import {
  addressNumber,
  findAddress,
  parityOf,
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
const house = (
  id: string | number,
  x: number,
  y: number,
  numbers?: string[],
): House => ({
  id: String(id),
  at: [x, y],
  ...(numbers ? { numbers } : {}),
});
const street = (name: string, houses: number, at: Pt): PlanStreet => ({
  key: name,
  name,
  from: null,
  to: null,
  piece: 1,
  pieces: 1,
  side: null,
  range: null,
  houses,
  doors: houses,
  homes: [],
  dots: [],
  nums: [],
  at,
  lines: [],
});
const keys = (parts: { streets: PlanStreet[] }[]) =>
  parts.map((p) => p.streets.map((s) => s.key).sort());

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
      const four = splitStreets(row, 4, { mode: 'own' });
      expect(four.map((p) => p.doors)).toEqual([20, 20, 20, 20]);
      expect(keys(four)).toEqual([
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
      expect(keys(splitStreets(column, 2, { mode: 'own' }))).toEqual([
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
      expect(two.map((p) => p.doors).sort()).toEqual([20, 20]);
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
      const three = splitStreets(town, 3, { mode: 'own' });
      expect(unevenness(three)).toBeLessThan(1.3);
      // Pairs near, from a start in the middle: as even.
      const near = splitStreets(town, 3, {
        mode: 'near',
        start: [7.8195, 51.709],
      });
      expect(unevenness(near)).toBeLessThan(1.3);
      expect(three.reduce((a, p) => a + p.houses, 0)).toBe(
        town.reduce((a, s) => a + s.houses, 0),
      );
    });

    it('is everything in one when one part is asked for', () => {
      expect(splitStreets(row, 1).map((p) => p.doors)).toEqual([80]);
    });

    it('lead the route to a street in the middle of the part', () => {
      const [p] = splitStreets(row.slice(0, 3), 1);
      expect(p.start).toEqual([7.002, 51]);
    });

    it('«near»: wedges round the start, every pair setting off next to it', () => {
      // Four arms of a cross round the start, ten doors each.
      const arms = [
        street('North', 10, [7, 51.002]),
        street('East', 10, [7.003, 51]),
        street('South', 10, [7, 50.998]),
        street('West', 10, [6.997, 51]),
      ];
      const start: Pt = [7, 51];
      const own = splitStreets(arms, 2, { mode: 'near', start });
      expect(own.map((p) => p.doors)).toEqual([20, 20]);
      // Each part is two neighbouring arms, never two opposite ones.
      for (const p of own) {
        const names = p.streets
          .map((s) => s.name)
          .sort()
          .join('+');
        expect([
          'East+North',
          'East+South',
          'South+West',
          'North+West',
        ]).toContain(names);
      }
    });

    it('«near» from a start at the edge: every pair begins next to it', () => {
      // A 6×3 grid of streets 100 m apart; the meeting place at the west edge.
      const grid: PlanStreet[] = [];
      for (let i = 0; i < 6; i++)
        for (let j = 0; j < 3; j++)
          grid.push(
            street(`G${i}${j}`, 5, [7 + i * 0.0014, 51 + j * 0.0009] as Pt),
          );
      const start: Pt = [6.9993, 51.0009];
      const nearest = (p: { streets: PlanStreet[] }) =>
        Math.min(
          ...p.streets.map((s) =>
            Math.hypot(
              (s.at[0] - start[0]) * 70_000,
              (s.at[1] - start[1]) * 110_540,
            ),
          ),
        );
      const near = splitStreets(grid, 2, { mode: 'near', start });
      expect(near.map((p) => p.doors)).toEqual([45, 45]);
      expect(Math.max(...near.map(nearest))).toBeLessThan(150);
      // Apart, one pair has to walk 250 m and more to its ground.
      const own = splitStreets(grid, 2, { mode: 'own', start });
      expect(Math.max(...own.map(nearest))).toBeGreaterThan(250);
    });

    it('give a «smaller» pair about two thirds of a share', () => {
      const parts = splitStreets(
        Array.from({ length: 16 }, (_, i) =>
          street(`S${i}`, 5, [7 + i * 0.001, 51]),
        ),
        3,
        { mode: 'own', smaller: [2] },
      );
      expect(parts.map((p) => p.doors)).toEqual([30, 20, 30]);
      expect(parts[1].smaller).toBe(true);
      expect(unevenness(parts)).toBe(1);
    });

    it('puts the streets of a part in walking order from where it starts', () => {
      const line = [0, 1, 2, 3].map((i) => ({
        ...street(`W${i}`, 5, [7 + i * 0.002, 51] as Pt),
        dots: [[7 + i * 0.002, 51]] as Pt[],
      }));
      // Shuffled, starting from the east end.
      const [p] = splitStreets([line[2], line[0], line[3], line[1]], 1, {
        start: [7.01, 51],
      });
      expect(p.streets.map((s) => s.key)).toEqual(['W3', 'W2', 'W1', 'W0']);
      expect(p.start).toEqual([7.006, 51]);
    });
  });

  describe('house numbers, doors and sides (13 November 2026)', () => {
    it('weighs a block of flats by its entrances', () => {
      const r = streetsWithHouses(
        [A],
        [
          house(1, 7.001, 51.0001, ['12', '12a', '14']),
          house(2, 7.002, 51.0001, ['16']),
          house(3, 7.0025, 51.0001),
        ],
      );
      expect(r.streets.map((s) => [s.houses, s.doors])).toEqual([[3, 5]]);
    });

    it('names a piece by its numbers when most houses have one', () => {
      const r = streetsWithHouses(
        [A],
        [
          house(1, 7.001, 51.0001, ['3']),
          house(2, 7.002, 51.0001, ['1']),
          house(3, 7.0025, 51.0001, ['5a']),
        ],
      );
      expect(r.streets[0].range).toEqual({ from: '1', to: '5a' });
      const few = streetsWithHouses(
        [A],
        [
          house(1, 7.001, 51.0001, ['3']),
          house(2, 7.002, 51.0001),
          house(3, 7.0025, 51.0001),
        ],
      );
      expect(few.streets[0].range).toBeNull();
    });

    it('gives a corner house numbered on the side street to that street', () => {
      // Ahornweg runs east; Kirchweg comes down from the north to it at 7.002.
      const kirch = {
        name: 'Kirchweg',
        lines: [
          [
            [7.002, 51.0003],
            [7.002, 51.002],
          ],
        ] as Pt[][],
      };
      const houses = [
        // Ahornweg 20–28 along the street…
        house('a1', 7.0005, 51.0001, ['20']),
        house('a2', 7.001, 51.0001, ['22']),
        house('a3', 7.0015, 51.0001, ['24']),
        house('a4', 7.0026, 51.0001, ['26']),
        house('a5', 7.003, 51.0001, ['28']),
        // …Kirchweg 1–5 up the side street…
        house('k1', 7.0022, 51.0005, ['3']),
        house('k2', 7.0022, 51.001, ['5']),
        // …and the corner house, nearer Ahornweg, but Kirchweg 1.
        house('corner', 7.0021, 51.00013, ['1']),
      ];
      const r = streetsWithHouses([A, kirch], houses);
      const of = (name: string) =>
        r.streets.filter((s) => s.name === name).flatMap((s) => s.homes);
      expect(of('Kirchweg').sort()).toEqual(['corner', 'k1', 'k2']);
      expect(of('Ahornweg')).not.toContain('corner');
    });

    describe('a main road', () => {
      const road = {
        name: 'Hauptstraße',
        kind: 'major_road',
        lines: [
          [
            [7.0, 51.0],
            [7.004, 51.0],
          ],
        ] as Pt[][],
      };
      // Odd numbers north of it, even south, 300 m long.
      const sides = [
        ...[1, 3, 5, 7, 9].map((n, i) =>
          house(`n${n}`, 7.0002 + i * 0.0009, 51.0002, [String(n)]),
        ),
        ...[2, 4, 6, 8, 10].map((n, i) =>
          house(`s${n}`, 7.0002 + i * 0.0009, 50.9998, [String(n)]),
        ),
      ];

      it('is walked by sides, named even and odd', () => {
        const r = streetsWithHouses([road], sides);
        expect(
          r.streets.map((s) => [s.key, s.side, s.range, s.houses]),
        ).toEqual([
          [
            'Hauptstraße@n',
            { parity: 'odd', toward: 'n' },
            { from: '1', to: '9' },
            5,
          ],
          [
            'Hauptstraße@s',
            { parity: 'even', toward: 's' },
            { from: '2', to: '10' },
            5,
          ],
        ]);
      });

      it('falls back to the compass when the numbers do not agree', () => {
        const mixed = sides.map((h, i) =>
          i === 0
            ? { ...h, numbers: ['2'] }
            : i === 1
              ? { ...h, numbers: ['4'] }
              : h,
        );
        const r = streetsWithHouses([road], mixed);
        expect(r.streets[0].side).toEqual({ parity: null, toward: 'n' });
      });

      it('a quiet street is walked whole, both sides', () => {
        const r = streetsWithHouses([{ ...road, kind: 'minor_road' }], sides);
        expect(r.streets.map((s) => [s.key, s.side, s.houses])).toEqual([
          ['Hauptstraße', null, 10],
        ]);
      });

      it('a short main road too', () => {
        const short = sides.filter((h) => h.at[0] < 7.0012);
        const r = streetsWithHouses([road], short);
        expect(r.streets.map((s) => s.side)).toEqual([null]);
      });
    });

    it("cuts a street heavier than a pair's share, however short (14 November 2026)", () => {
      // 30 houses within 100 m: never cut by length.
      const row = Array.from({ length: 30 }, (_, i) =>
        house(i, 7.0002 + i * 0.00004, 51.0001),
      );
      expect(streetsWithHouses([A], row).streets).toHaveLength(1);
      const cut = streetsWithHouses([A], row, { maxDoors: 10 }).streets;
      expect(cut.map((x) => x.doors)).toEqual([10, 10, 10]);
    });

    it('keeps a far house with a number (a farm), leaves a far one without (a barn)', () => {
      // 330 m north of Ahornweg.
      const r = streetsWithHouses(
        [A],
        [house('farm', 7.001, 51.003, ['40']), house('barn', 7.002, 51.003)],
      );
      expect(r.streets[0].homes).toEqual(['farm']);
      expect(r.left).toBe(1);
    });

    it('sends a lone house without a number from a named drive to the next street', () => {
      const drive = {
        name: 'Post',
        lines: [
          [
            [7.001, 51.0003],
            [7.0012, 51.0003],
          ],
        ] as Pt[][],
      };
      const hs = [
        house('h', 7.0011, 51.00034),
        house('a', 7.002, 51.0001),
        house('b', 7.0025, 51.0001),
      ];
      const r = streetsWithHouses([A, drive], hs);
      expect(r.streets.map((x) => x.name)).toEqual(['Ahornweg']);
      // With a number it is an address on that drive: it stays.
      const kept = streetsWithHouses(
        [A, drive],
        [{ ...hs[0], numbers: ['1'] }, hs[1], hs[2]],
      );
      expect(kept.streets.map((x) => x.name).sort()).toEqual([
        'Ahornweg',
        'Post',
      ]);
    });

    it('says a side is even or odd only when its numbers agree', () => {
      const hs = ['2', '4', '6', '8', '10', '12', '14', '16', '18', '3'].map(
        (n, i) => house(i, 7, 51, [n]),
      );
      expect(
        parityOf(
          hs.map((_, i) => i),
          hs,
        ),
      ).toBe('even');
      const half = hs.map((h, i) => (i < 5 ? h : { ...h, numbers: ['5'] }));
      expect(
        parityOf(
          half.map((_, i) => i),
          half,
        ),
      ).toBeNull();
    });

    it('finds an address on the map: street and number', () => {
      const houses = [
        house(1, 7.001, 51.0001, ['12']),
        house(2, 7.001, 51.0008, ['12']),
      ];
      expect(findAddress('Ahornweg 12', [A, B], houses)).toEqual([
        7.001, 51.0001,
      ]);
      expect(findAddress('Birkenweg 12, Hamm', [A, B], houses)).toEqual([
        7.001, 51.0008,
      ]);
      expect(findAddress('Ahornweg 14', [A, B], houses)).toBeNull();
      expect(findAddress('am Supermarkt', [A, B], houses)).toBeNull();
      expect(addressNumber('Dillweg 12 a')).toBe('12a');
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
      // With its number on a piece: that piece's part alone.
      const numbered = [
        { ...pieces[0], nums: ['1', '3', '5'] },
        { ...pieces[1], nums: ['7', '9'] },
      ];
      const two = splitStreets(numbered, 2, { mode: 'own' });
      const which = two.find((p) =>
        p.streets.some((x) => x.nums.includes('9')),
      )!.n;
      expect(partsOfAddress(two, 'Lang 9')).toEqual([which]);
      expect(partsOfAddress(two, 'Lang 11')).toEqual([1, 2]);
    });
  });
});

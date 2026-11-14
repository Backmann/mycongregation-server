import { endsOf, graphOf, routePart, thin, TODAY_M } from './way';
import { dist, type Pt } from './split';

/**
 * The way through a part (14 November 2026): the order of its streets and
 * the roads between them follow the roads, never longer than the order
 * given; today's streets are about one outing.
 */
describe('the way through a part', () => {
  // Metres to degrees at 51° N, round 7° E.
  const E = (m: number) => m / (111_320 * Math.cos((51 * Math.PI) / 180));
  const N = (m: number) => m / 110_540;
  const at = (x: number, y: number): Pt => [7 + E(x), 51 + N(y)];
  const line = (...ps: [number, number][]) => ps.map(([x, y]) => at(x, y));
  const len = (l: Pt[]) => l.slice(1).reduce((a, p, i) => a + dist(l[i], p), 0);

  it('joins two lines that cross without sharing a point', () => {
    const g = graphOf([line([0, 0], [200, 0]), line([100, -100], [100, 100])]);
    const joined = g.next.some((n, i) =>
      n.some(
        (e) =>
          g.pts[i][0] !== g.pts[e.to][0] &&
          g.pts[i][1] !== g.pts[e.to][1] &&
          e.m < 15,
      ),
    );
    expect(joined).toBe(true);
  });

  it('the ends of a street are its points furthest apart', () => {
    const [a, b] = endsOf([line([0, 0], [50, 0], [100, 0])])!;
    expect(Math.round(dist(a, b))).toBe(100);
  });

  it('a line thinned keeps its corners, drops points on the straight', () => {
    expect(thin(line([0, 0], [50, 1], [100, 0], [100, 100]))).toHaveLength(3);
  });

  // A river at y = 50: the only bridge is far east, at x = 600.
  const roads = [
    line([0, 0], [700, 0]), // the near bank
    line([0, 100], [700, 100]), // the far bank
    line([600, 0], [600, 100]), // the bridge
    line([0, 0], [0, -300]), // a street on the near side, going south
  ];
  const across = { key: 'across', lines: [line([0, 100], [100, 100])] };
  const south = { key: 'south', lines: [line([0, -100], [0, -300])] };

  it('walks the street near by road first, not the one over the river', () => {
    const w = routePart(roads, [across, south], at(0, 0));
    expect(w.streets.map((s) => s.key)).toEqual(['south', 'across']);
    expect(w.straight).toBe(0);
    expect(w.linkM).toBeLessThan(w.linkGiven);
  });

  it('the road to the street over the river goes over the bridge', () => {
    const w = routePart(roads, [across], at(0, 0));
    const east = Math.max(...w.links[0].map((p) => p[0]));
    expect(east).toBeGreaterThan(at(590, 0)[0]);
    // About 600 east, over, 500 back west: some 1 200 m, not 100.
    expect(len(w.links[0])).toBeGreaterThan(1150);
    expect(len(w.links[0])).toBeLessThan(1300);
  });

  it('enters a street at its nearer end and goes on from the other', () => {
    // Drawn from its far end: still entered at the near one.
    const backwards = { key: 'south', lines: [line([0, -300], [0, -100])] };
    const w = routePart(roads, [backwards, across], at(0, 0));
    expect(
      Math.round(dist(w.links[0][w.links[0].length - 1], at(0, -100))),
    ).toBe(0);
    expect(Math.round(dist(w.links[1][0], at(0, -300)))).toBe(0);
  });

  it('a street off every road is reached in a straight line', () => {
    const lost = { key: 'lost', lines: [line([3000, 3000], [3100, 3000])] };
    const w = routePart(roads, [lost], at(0, 0));
    expect(w.straight).toBe(1);
    expect(w.links[0]).toHaveLength(2);
  });

  // A row of short streets along one road, given in a muddled order.
  const main = [line([0, 0], [2000, 0])];
  const stub = (x: number) => ({
    key: `s${x}`,
    lines: [line([x, 0], [x, 60])],
  });

  it('never longer than the order given; here much shorter', () => {
    const muddled = [stub(1500), stub(100), stub(1900), stub(500), stub(1000)];
    const w = routePart(main, muddled, at(0, 0));
    expect(w.streets.map((s) => s.key)).toEqual([
      's100',
      's500',
      's1000',
      's1500',
      's1900',
    ]);
    expect(w.linkM).toBeLessThan(w.linkGiven * 0.6);
    const tidy = [stub(100), stub(500), stub(1000), stub(1500), stub(1900)];
    const again = routePart(main, tidy, at(0, 0));
    expect(again.linkM).toBeLessThanOrEqual(again.linkGiven + 0.5);
  });

  it('today: streets up to about one outing, at least one', () => {
    const tidy = [stub(100), stub(500), stub(1000), stub(1500), stub(1900)];
    const w = routePart(main, tidy, at(0, 0));
    // 100 + 60, then about 400 + 60 + 60, … the fourth runs past 1 km.
    expect(w.today).toBe(2);
    expect(routePart(main, [stub(1900)], at(0, 0)).today).toBe(1);
    expect(TODAY_M).toBe(1000);
  });

  it('fast enough for a big territory', () => {
    const grid: Pt[][] = [];
    for (let i = 0; i <= 30; i++) {
      grid.push(line([i * 100, 0], [i * 100, 3000]));
      grid.push(line([0, i * 100], [3000, i * 100]));
    }
    const streets = Array.from({ length: 30 }, (_, i) => ({
      key: `g${i}`,
      lines: [
        line(
          [(i % 6) * 500, Math.floor(i / 6) * 500],
          [(i % 6) * 500 + 100, Math.floor(i / 6) * 500],
        ),
      ],
    }));
    const t0 = Date.now();
    const w = routePart(grid, streets, at(0, 0));
    expect(w.streets).toHaveLength(30);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

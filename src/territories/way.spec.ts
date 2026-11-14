import { endsOf, graphOf, linkMetres, wayThrough } from './way';
import { dist, type Pt } from './split';

/**
 * The way through a part (14 November 2026): the order of its streets and
 * the roads between them follow the roads, not the straight line.
 */
describe('the way through a part', () => {
  // Metres to degrees at 51° N, round 7° E.
  const E = (m: number) => m / (111_320 * Math.cos((51 * Math.PI) / 180));
  const N = (m: number) => m / 110_540;
  const at = (x: number, y: number): Pt => [7 + E(x), 51 + N(y)];
  const line = (...ps: [number, number][]) => ps.map(([x, y]) => at(x, y));

  it('joins two lines that cross without sharing a point', () => {
    const g = graphOf([line([0, 0], [200, 0]), line([100, -100], [100, 100])]);
    const crossing = g.next.some((n, i) =>
      n.some(
        (e) =>
          Math.abs(g.pts[i][1] - g.pts[e.to][1]) > 0 &&
          Math.abs(g.pts[i][0] - g.pts[e.to][0]) > 0 &&
          e.m < 15,
      ),
    );
    expect(crossing).toBe(true);
  });

  it('the ends of a street are its points furthest apart', () => {
    const [a, b] = endsOf([line([0, 0], [50, 0], [100, 0])])!;
    expect(Math.round(dist(a, b))).toBe(100);
  });

  // A river at y = 50: the only bridge is far east, at x = 600.
  const roads = [
    line([0, 0], [700, 0]), // the near bank
    line([0, 100], [700, 100]), // the far bank
    line([600, 0], [600, 100]), // the bridge
    line([0, 0], [0, -300]), // a street on the near side, going south
  ];
  const across = { key: 'across', lines: [line([0, 100], [100, 100])] }; // 100 m away, over the river
  const south = { key: 'south', lines: [line([0, -100], [0, -300])] }; // 100 m away on the near side

  it('takes the street near by road first, not the one near over the river', () => {
    const w = wayThrough(roads, [across, south], at(0, 0));
    expect(w.streets.map((s) => s.key)).toEqual(['south', 'across']);
    expect(w.straight).toBe(0);
  });

  it('the link to the street over the river goes over the bridge', () => {
    const w = wayThrough(roads, [across], at(0, 0));
    const link = w.links[0];
    const east = Math.max(...link.map((p) => p[0]));
    expect(east).toBeGreaterThan(at(590, 0)[0]);
    // About 600 east, over, 500 back west: some 1 200 m, not 100.
    expect(w.linkM).toBeGreaterThan(1150);
    expect(w.linkM).toBeLessThan(1300);
  });

  it('enters a street at its nearer end and leaves at the other', () => {
    const w = wayThrough(roads, [south, across], at(0, 0));
    // From the far end of «south» (y = -300) back north, over the bridge.
    const second = w.links[1];
    expect(Math.round(dist(second[0], at(0, -300)))).toBe(0);
  });

  it('a street off every road is reached in a straight line', () => {
    const lost = { key: 'lost', lines: [line([3000, 3000], [3100, 3000])] };
    const w = wayThrough(roads, [lost], at(0, 0));
    expect(w.straight).toBe(1);
    expect(w.links[0]).toHaveLength(2);
  });

  it('measures the roads between streets of any order', () => {
    const good = linkMetres(roads, [south, across], at(0, 0));
    const bad = linkMetres(roads, [across, south], at(0, 0));
    expect(good).toBeLessThan(bad);
  });
});

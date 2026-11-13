import { walkOrder } from './business-order';
import { businessGroup, handKind } from './business-kinds';

const at = (id: string, lon: number | null, lat: number | null, name = id) => ({
  id,
  name,
  lon,
  lat,
});

describe('the walking order of a business list (13 November 2026)', () => {
  it('walks a street end to end, not by the order things were added', () => {
    // Five shops in a row along a street; their ids say nothing of where.
    const ids = ['q', 'b', 'x', 'a', 'm'];
    const row = ids.map((id, i) => at(id, 7.001 + i * 0.001, 51));
    const out = walkOrder([row[2], row[4], row[0], row[3], row[1]]).map(
      (i) => i.id,
    );
    expect([out.join(''), [...out].reverse().join('')]).toContain('qbxam');
  });

  it('finishes one street before it crosses to the next', () => {
    // Two parallel streets 300 m apart, shops 50 m apart along each; the
    // ids mixed so that their order would zigzag across.
    const north = ['k', 'c', 'w'];
    const south = ['d', 'v', 'a'];
    const items = [
      ...north.map((id, i) => at(id, 7 + i * 0.0007, 51.003)),
      ...south.map((id, i) => at(id, 7 + i * 0.0007, 51)),
    ];
    const side = (id: string) => (north.includes(id) ? 'n' : 's');
    const sides = walkOrder(items).map((i) => side(i.id));
    // One crossing only: nnnsss or sssnnn.
    expect(['nnnsss', 'sssnnn']).toContain(sides.join(''));
  });

  it('puts the ones without a point last, by name; keeps everything once', () => {
    const items = [
      at('x', null, null, 'Zeta'),
      at('p', 7, 51),
      at('y', null, null, 'Alpha'),
      at('q', 7.001, 51),
    ];
    const out = walkOrder(items);
    expect(out.slice(2).map((i) => i.name)).toEqual(['Alpha', 'Zeta']);
    expect(out.map((i) => i.id).sort()).toEqual(['p', 'q', 'x', 'y']);
    expect(walkOrder([])).toEqual([]);
  });

  it('gives the same order whatever order it was given', () => {
    const items = [0, 1, 2, 3, 4, 5].map((i) =>
      at(`k${i}`, 7 + ((i * 37) % 11) * 0.0003, 51 + ((i * 13) % 7) * 0.0002),
    );
    const one = walkOrder(items).map((i) => i.id);
    const two = walkOrder([...items].reverse()).map((i) => i.id);
    expect(two).toEqual(one);
  });
});

describe('business kinds (13 November 2026)', () => {
  it('counts shops, food, services, doctors and hotels; not places', () => {
    expect(businessGroup('supermarket')).toBe('shop');
    expect(businessGroup('fast_food')).toBe('food');
    expect(businessGroup('hairdresser')).toBe('service');
    expect(businessGroup('doctors')).toBe('health');
    expect(businessGroup('hotel')).toBe('lodging');
    for (const place of [
      'school',
      'kindergarten',
      'place_of_worship',
      'memorial',
      'bus_stop',
      'parking',
      'park',
      'artwork',
    ]) {
      expect(businessGroup(place)).toBeNull();
    }
  });
  it('a kind typed by hand is a known one or «other»', () => {
    expect(handKind('bakery')).toBe('bakery');
    expect(handKind('school')).toBe('other');
    expect(handKind('<b>')).toBe('other');
  });
});

import { homesByCadastre, officialUse } from './official-use';

/** The cadastre's words, as they come in ALKIS NW (14 November 2026). */
describe('what the cadastre says a building is', () => {
  it.each([
    ['Wohngebäude', 'home'],
    ['Gemischt genutztes Gebäude mit Wohnen', 'home'],
    ['Wohn- und Geschäftsgebäude', 'home'],
    ['Land- und forstwirtschaftliches Wohngebäude', 'home'],
    ['Bauernhaus', 'home'],
    ['Gebäude für Wirtschaft oder Gewerbe', 'not'],
    ['Gebäude für Land- und Forstwirtschaft', 'not'],
    ['Gebäude zum Parken', 'not'],
    ['Gebäude zur Freizeitgestaltung', 'not'],
    ['Allgemein bildende Schule', 'not'],
    ['Kirche', 'not'],
    ['Sonstiges', 'unsure'],
    ['Nach Quellenlage nicht zu spezifizieren', 'unsure'],
    ['Gebäude für soziale Zwecke', 'unsure'],
    ['Heilanstalt, Pflegeanstalt, Pflegestation', 'unsure'],
    ['Seniorenheim', 'unsure'],
    ['Gebäude für Erholungszwecke', 'unsure'],
  ])('%s → %s', (fn, want) => {
    expect(officialUse(fn)).toBe(want);
  });

  it('unknown to the cadastre: null', () => {
    expect(officialUse(null)).toBeNull();
    expect(officialUse('  ')).toBeNull();
  });
});

describe('homes by the cadastre (proposed rule)', () => {
  const h = (
    osmId: string,
    official: string | null,
    officialId: string | null,
    numbers: string | null,
    areaM2: number,
    home = true,
  ) => ({ osmId, official, officialId, numbers, areaM2, home });

  it('a building the map draws in two pieces is one home: the piece with a number', () => {
    const r = homesByCadastre([
      h('1', 'Wohngebäude', 'B', '185', 90),
      h('2', 'Wohngebäude', 'B', null, 120, false),
    ]);
    expect([r.get('1'), r.get('2')]).toEqual([true, false]);
  });

  it('no piece numbered: the biggest', () => {
    const r = homesByCadastre([
      h('1', 'Wohngebäude', 'B', null, 40),
      h('2', 'Wohngebäude', 'B', null, 120),
    ]);
    expect([r.get('1'), r.get('2')]).toEqual([false, true]);
  });

  it('not a home by the cadastre: not one, number or not', () => {
    const r = homesByCadastre([h('1', 'Gebäude zum Parken', 'G', '2', 250)]);
    expect(r.get('1')).toBe(false);
  });

  it('unsure counts as a home', () => {
    expect(
      homesByCadastre([h('1', 'Sonstiges', 'S', null, 80, false)]).get('1'),
    ).toBe(true);
  });

  it('unknown to the cadastre: as the rule without it says', () => {
    const r = homesByCadastre([
      h('1', null, null, null, 40, false),
      h('2', null, null, null, 200, true),
    ]);
    expect([r.get('1'), r.get('2')]).toEqual([false, true]);
  });

  it('a barn in the same building as the house does not take the number away', () => {
    // Two cadastre buildings: each its own home or not.
    const r = homesByCadastre([
      h('1', 'Wohngebäude', 'A', '7', 150),
      h('2', 'Gebäude für Land- und Forstwirtschaft', 'B', null, 600),
    ]);
    expect([r.get('1'), r.get('2')]).toEqual([true, false]);
  });
});

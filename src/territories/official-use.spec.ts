import { officialUse } from './official-use';
import { OFFICIAL_WORDS } from './official-use.words';

describe('what the cadastre says a building is', () => {
  it.each(OFFICIAL_WORDS)('%s → %s', (fn, want) => {
    expect(officialUse(fn)).toBe(want);
  });

  it('unknown to the cadastre: null', () => {
    expect(officialUse(null)).toBeNull();
    expect(officialUse('  ')).toBeNull();
  });
});

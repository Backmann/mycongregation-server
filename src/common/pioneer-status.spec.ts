import { isActivePermanentPioneer } from './pioneer-status';
import { PioneerType } from './enums/pioneer-type.enum';

describe('isActivePermanentPioneer', () => {
  it('is false when there is no pioneer type', () => {
    expect(isActivePermanentPioneer(PioneerType.NONE, null)).toBe(false);
    expect(isActivePermanentPioneer(null, '2026-01-01')).toBe(false);
  });

  it('is true when a type is set but no start date is given', () => {
    expect(isActivePermanentPioneer(PioneerType.REGULAR, null)).toBe(true);
  });

  it('is false before the pioneer start month', () => {
    // Start August, testing July → not yet a pioneer.
    expect(
      isActivePermanentPioneer(PioneerType.REGULAR, '2026-08-01', '2026-07-15'),
    ).toBe(false);
  });

  it('is true from the pioneer start month onward', () => {
    expect(
      isActivePermanentPioneer(PioneerType.REGULAR, '2026-08-01', '2026-08-01'),
    ).toBe(true);
    expect(
      isActivePermanentPioneer(PioneerType.SPECIAL, '2026-08-01', '2026-10-05'),
    ).toBe(true);
  });

  it('accepts a Date for the month being tested', () => {
    expect(
      isActivePermanentPioneer(
        PioneerType.MISSIONARY,
        '2026-08-01',
        new Date(Date.UTC(2026, 6, 15)), // July
      ),
    ).toBe(false);
  });
});

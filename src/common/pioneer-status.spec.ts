import {
  isActivePermanentPioneer,
  pioneerTypeInMonth,
  wasPermanentPioneerInMonth,
} from './pioneer-status';
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

/**
 * Which kind of pioneer somebody was in a given month.
 *
 * The card answers «what is he now», which is the wrong question for anything
 * historical: a brother who pioneered 2019–2023 reads as an ordinary publisher
 * for every month of it, so his hours cannot be entered and the monthly figures
 * count him in the wrong line.
 */
describe('pioneerTypeInMonth', () => {
  const ended = {
    pioneerType: PioneerType.REGULAR,
    startMonth: '2019-03-01',
    endMonth: '2023-08-01',
  };
  const running = {
    pioneerType: PioneerType.REGULAR,
    startMonth: '2026-03-01',
    endMonth: null,
  };

  it('finds a spell that has already ended — the case the card forgets', () => {
    expect(pioneerTypeInMonth([ended], '2021-06-01')).toBe(PioneerType.REGULAR);
    expect(wasPermanentPioneerInMonth([ended], '2021-06-01')).toBe(true);
  });

  it('says nothing outside the spell, on either side', () => {
    expect(pioneerTypeInMonth([ended], '2019-02-01')).toBe(PioneerType.NONE);
    expect(pioneerTypeInMonth([ended], '2023-09-01')).toBe(PioneerType.NONE);
  });

  it('includes both edge months', () => {
    expect(pioneerTypeInMonth([ended], '2019-03-01')).toBe(PioneerType.REGULAR);
    expect(pioneerTypeInMonth([ended], '2023-08-01')).toBe(PioneerType.REGULAR);
  });

  it('treats a running spell as open-ended', () => {
    expect(pioneerTypeInMonth([running], '2026-09-01')).toBe(
      PioneerType.REGULAR,
    );
    expect(pioneerTypeInMonth([running], '2026-02-01')).toBe(PioneerType.NONE);
  });

  it('handles somebody who pioneered twice — two rows, which the card could not express', () => {
    const both = [ended, running];
    expect(pioneerTypeInMonth(both, '2021-06-01')).toBe(PioneerType.REGULAR);
    expect(pioneerTypeInMonth(both, '2024-06-01')).toBe(PioneerType.NONE);
    expect(pioneerTypeInMonth(both, '2026-06-01')).toBe(PioneerType.REGULAR);
  });
});

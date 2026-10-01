import { memberAtEndOf, memberAtServiceYearEnd } from './members-of-period';

describe('memberAtEndOf — who belonged when a month ended', () => {
  const august = memberAtEndOf('2026-08-01');

  it('keeps somebody who left on the first day after the month', () => {
    expect(
      august({
        removedAt: new Date('2026-09-01'),
        deletedAt: new Date('2026-09-27T10:00:00Z'),
      }),
    ).toBe(true);
  });

  it('drops somebody who left inside the month', () => {
    expect(
      august({
        removedAt: new Date('2026-08-12'),
        deletedAt: new Date('2026-08-13T10:00:00Z'),
      }),
    ).toBe(false);
  });

  it('goes by the day he left, not the day it was entered', () => {
    // Left in August, entered in September: gone for August all the same.
    expect(
      august({
        removedAt: new Date('2026-08-20'),
        deletedAt: new Date('2026-09-27T10:00:00Z'),
      }),
    ).toBe(false);
  });

  it('counts a card put back on the roll, whatever its old departure says', () => {
    expect(
      august({
        removedAt: new Date('2026-03-01'),
        deletedAt: null,
        restoredAt: new Date('2026-04-02T10:00:00Z'),
      }),
    ).toBe(true);
  });

  it('counts somebody who never left', () => {
    expect(august({ removedAt: null, deletedAt: null })).toBe(true);
  });
});

describe('memberAtServiceYearEnd — the line the annual report is drawn at', () => {
  it('is 31 August of the year that closes the service year', () => {
    const y2025 = memberAtServiceYearEnd(2025);
    expect(y2025({ removedAt: '2026-08-31' })).toBe(false);
    expect(y2025({ removedAt: '2026-09-01' })).toBe(true);
  });
});

import { versionForWeek } from './week-rules';

/**
 * Which schedule version is in force for a week — the one rule every server
 * lookup now goes through (26 September).
 */
describe('versionForWeek', () => {
  const jan = { effectiveFrom: '2026-01-05', midweekDow: 3 };
  const wed = { effectiveFrom: '2026-09-23', midweekDow: 4 }; // a Wednesday
  const future = { effectiveFrom: '2027-01-04', midweekDow: 2 };

  it('a version dated on a Wednesday starts the following Monday', () => {
    expect(versionForWeek([jan, wed], '2026-09-21')).toBe(jan); // its own week
    expect(versionForWeek([jan, wed], '2026-09-28')).toBe(wed); // next week
  });

  it('any date of the week reads as its week', () => {
    // Thursday 24 September is after the version's date, but the week began on
    // the 21st — one schedule per week.
    expect(versionForWeek([jan, wed], '2026-09-24')).toBe(jan);
    expect(versionForWeek([jan, wed], '2026-10-01')).toBe(wed);
  });

  it('does not depend on the order it is given', () => {
    expect(versionForWeek([future, wed, jan], '2026-10-05')).toBe(wed);
    expect(versionForWeek([wed, jan, future], '2026-10-05')).toBe(wed);
  });

  it('a version still to come does not govern today', () => {
    expect(versionForWeek([jan, future], '2026-09-28')).toBe(jan);
  });

  it('before the first version, the first applies', () => {
    expect(versionForWeek([wed, future], '2025-06-02')).toBe(wed);
    expect(versionForWeek([], '2026-09-28')).toBeNull();
  });
});

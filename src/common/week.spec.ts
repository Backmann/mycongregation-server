import { mondayOf } from './week';

describe('mondayOf', () => {
  it('gives the Monday of the week a date falls in', () => {
    expect(mondayOf('2026-08-05')).toBe('2026-08-03'); // Wednesday
    expect(mondayOf('2026-08-03')).toBe('2026-08-03'); // Monday itself
  });

  it('counts Sunday as the END of its week, not the start', () => {
    // The one every hand-written version gets wrong at least once: in
    // JavaScript Sunday is day 0, so the naive arithmetic jumps forward a week.
    expect(mondayOf('2026-08-02')).toBe('2026-07-27');
    expect(mondayOf('2026-08-09')).toBe('2026-08-03');
  });

  it('steps back over the turn of the month and the year', () => {
    expect(mondayOf('2026-03-01')).toBe('2026-02-23'); // a Sunday
    expect(mondayOf('2027-01-01')).toBe('2026-12-28'); // a Friday
  });

  it('is unmoved by the summer-time change', () => {
    // The old copy in me.service did its arithmetic in the SERVER's local
    // time, where a day is not always 24 hours long. This one works in whole
    // calendar days, so the clocks changing under it means nothing.
    expect(mondayOf('2026-03-29')).toBe('2026-03-23'); // CEST begins
    expect(mondayOf('2026-10-25')).toBe('2026-10-19'); // CET returns
  });

  it('is idempotent — a Monday stays where it is', () => {
    const once = mondayOf('2026-08-07');
    expect(mondayOf(once)).toBe(once);
  });

  it('accepts a timestamp and answers about its calendar date', () => {
    expect(mondayOf('2026-08-05T18:30:00Z')).toBe('2026-08-03');
  });

  it('refuses a value that is not a date rather than inventing a week', () => {
    expect(() => mondayOf('not a date')).toThrow();
  });
});

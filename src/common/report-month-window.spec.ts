import {
  REPORT_CLOSING_DAY,
  isMonthClosingDay,
  lastClosedReportMonth,
  monthKey,
} from './report-month-window';
import { localDateParts } from './congregation-clock';

/** 'YYYY-MM' of the month the function returns, for readable expectations. */
const asMonth = (d: Date): string => monthKey(d).slice(0, 7);

describe('lastClosedReportMonth', () => {
  it('leaves last month open while its reports are still being collected', () => {
    // 3 August: July's reports are due by the 20th. June is the last month
    // anyone could be late for.
    expect(
      asMonth(lastClosedReportMonth(new Date('2026-08-03T09:00:00Z'))),
    ).toBe('2026-06');
  });

  it('still leaves it open on the eve of the deadline', () => {
    expect(
      asMonth(lastClosedReportMonth(new Date('2026-08-19T09:00:00Z'))),
    ).toBe('2026-06');
  });

  it('closes it on the deadline itself', () => {
    expect(
      asMonth(lastClosedReportMonth(new Date('2026-08-20T09:00:00Z'))),
    ).toBe('2026-07');
  });

  it('keeps it closed for the rest of the month', () => {
    expect(
      asMonth(lastClosedReportMonth(new Date('2026-08-31T09:00:00Z'))),
    ).toBe('2026-07');
  });

  it('steps back over the turn of the year', () => {
    // 5 January: December's reports are still coming in, so November is the
    // last closed month — and the year has to go back with it.
    expect(
      asMonth(lastClosedReportMonth(new Date('2027-01-05T09:00:00Z'))),
    ).toBe('2026-11');
    expect(
      asMonth(lastClosedReportMonth(new Date('2027-01-25T09:00:00Z'))),
    ).toBe('2026-12');
  });

  it('reads the date in the congregation timezone, not in UTC', () => {
    // 23:00 UTC on the 19th is already the 20th in Berlin. Judged in UTC the
    // deadline would arrive a day late for this congregation.
    const moment = new Date('2026-08-19T23:00:00Z');
    expect(asMonth(lastClosedReportMonth(moment, 'Europe/Berlin'))).toBe(
      '2026-07',
    );
    expect(asMonth(lastClosedReportMonth(moment, 'UTC'))).toBe('2026-06');
  });

  it('falls back to Berlin rather than throwing on an unusable timezone', () => {
    expect(
      asMonth(
        lastClosedReportMonth(new Date('2026-08-25T09:00:00Z'), 'Nowhere/Here'),
      ),
    ).toBe('2026-07');
  });
});

describe('isMonthClosingDay', () => {
  it('is true only on the closing day', () => {
    expect(isMonthClosingDay(new Date('2026-08-19T09:00:00Z'))).toBe(false);
    expect(isMonthClosingDay(new Date('2026-08-20T09:00:00Z'))).toBe(true);
    expect(isMonthClosingDay(new Date('2026-08-21T09:00:00Z'))).toBe(false);
  });

  it('is true exactly once a month for a nightly job in any timezone', () => {
    // The sweep runs at 03:00 UTC. Walk a whole month of runs for a timezone
    // well behind UTC and count the nights it would speak: the local date
    // advances by one on each run, so the closing day is hit once.
    let hits = 0;
    for (let day = 1; day <= 31; day++) {
      const at = new Date(Date.UTC(2026, 7, day, 3, 0, 0));
      if (isMonthClosingDay(at, 'America/Chicago')) hits++;
    }
    expect(hits).toBe(1);
  });

  it('uses a day that exists in every month', () => {
    // A closing day of 29, 30 or 31 would be skipped in some months and the
    // sweep would go a month without speaking. 20 is always there.
    expect(REPORT_CLOSING_DAY).toBeLessThanOrEqual(28);
  });
});

describe('localDateParts', () => {
  it("returns the congregation's own calendar date", () => {
    expect(
      localDateParts(new Date('2026-08-19T23:30:00Z'), 'Europe/Berlin'),
    ).toEqual({ year: 2026, month: 8, day: 20 });
  });
});

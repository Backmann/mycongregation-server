import {
  DEFAULT_CONGREGATION_TIMEZONE,
  localDateParts,
  minutesOfDayIn,
  todayIn,
} from './congregation-clock';
import { CongregationClock } from './congregation-clock.service';

describe('congregation clock — pure helpers', () => {
  it('answers with the congregation\u2019s own date, not the server\u2019s', () => {
    // 22:30 UTC on 3 August is already the 4th in Berlin and still the 3rd in
    // Chicago. Every date rule in the app — a week that has passed, an absence
    // that ended, a report month that closed — turns on this one answer.
    const at = new Date('2026-08-03T22:30:00Z');
    expect(todayIn(at, 'Europe/Berlin')).toBe('2026-08-04');
    expect(todayIn(at, 'America/Chicago')).toBe('2026-08-03');
    expect(todayIn(at, 'Asia/Tokyo')).toBe('2026-08-04');
  });

  it('falls back to the default when a congregation has none on record', () => {
    const at = new Date('2026-08-03T22:30:00Z');
    expect(todayIn(at, null)).toBe(todayIn(at, DEFAULT_CONGREGATION_TIMEZONE));
    expect(todayIn(at, '')).toBe(todayIn(at, DEFAULT_CONGREGATION_TIMEZONE));
  });

  it('falls back rather than throwing on a timezone that does not exist', () => {
    // A bad value in one congregation's settings must not take a nightly job
    // down for every other congregation.
    const at = new Date('2026-08-03T22:30:00Z');
    expect(todayIn(at, 'Nowhere/Here')).toBe(
      todayIn(at, DEFAULT_CONGREGATION_TIMEZONE),
    );
  });

  it('keeps the date right across the summer-time change', () => {
    // 00:30 UTC on the night Berlin goes from CEST to CET: 02:30 local before
    // the change, and the date is the 25th either way.
    expect(todayIn(new Date('2026-10-25T00:30:00Z'), 'Europe/Berlin')).toBe(
      '2026-10-25',
    );
  });

  it('reads the wall clock, not UTC', () => {
    const at = new Date('2026-08-03T22:30:00Z');
    expect(minutesOfDayIn(at, 'Europe/Berlin')).toBe(30); // 00:30 next day
    expect(minutesOfDayIn(at, 'UTC')).toBe(22 * 60 + 30);
  });

  it('reports midnight as zero minutes, not 1440', () => {
    expect(
      minutesOfDayIn(new Date('2026-08-03T22:00:00Z'), 'Europe/Berlin'),
    ).toBe(0);
  });

  it('gives the parts of the local date', () => {
    expect(
      localDateParts(new Date('2026-01-31T23:30:00Z'), 'Europe/Berlin'),
    ).toEqual({ year: 2026, month: 2, day: 1 });
  });
});

describe('CongregationClock', () => {
  const clockFor = (timezone: string | null) =>
    new CongregationClock({
      findOne: async () => ({ id: 'cong-1', timezone }),
    } as any);

  it('uses the timezone the congregation has on record', async () => {
    const tokyo = await clockFor('Asia/Tokyo').timezoneOf('cong-1');
    expect(tokyo).toBe('Asia/Tokyo');
  });

  it('uses the default when the congregation has none', async () => {
    expect(await clockFor(null).timezoneOf('cong-1')).toBe(
      DEFAULT_CONGREGATION_TIMEZONE,
    );
  });

  it('uses the default for a congregation that is not there', async () => {
    const clock = new CongregationClock({ findOne: async () => null } as any);
    expect(await clock.timezoneOf('gone')).toBe(DEFAULT_CONGREGATION_TIMEZONE);
  });

  it('asks the database every time, so a corrected setting takes effect', async () => {
    // No cache on purpose: a congregation that fixes its timezone in the
    // settings should not keep getting yesterday's answer.
    let timezone = 'Europe/Berlin';
    const clock = new CongregationClock({
      findOne: async () => ({ id: 'cong-1', timezone }),
    } as any);
    expect(await clock.timezoneOf('cong-1')).toBe('Europe/Berlin');
    timezone = 'Asia/Tokyo';
    expect(await clock.timezoneOf('cong-1')).toBe('Asia/Tokyo');
  });

  it('gives today and the time of day for that congregation', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-08-03T22:30:00Z') });
    try {
      const berlin = clockFor('Europe/Berlin');
      const chicago = clockFor('America/Chicago');
      expect(await berlin.todayFor('cong-1')).toBe('2026-08-04');
      expect(await chicago.todayFor('cong-1')).toBe('2026-08-03');
      expect(await berlin.minutesOfDayFor('cong-1')).toBe(30);
    } finally {
      jest.useRealTimers();
    }
  });
});

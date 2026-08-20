import {
  reviewPioneerYear,
  PIONEER_YEAR_GOAL,
  PIONEER_YEAR_MINIMUM,
} from './pioneer-year-review';

/**
 * The numbers the service committee will look at when deciding whether a man
 * carries on pioneering.
 *
 * Which is why the awkward cases matter more than the ordinary one: a total
 * read without «August is not in yet» beside it, or read about somebody who
 * only started pioneering in March, is a number that accuses the wrong person.
 */
describe('reviewPioneerYear', () => {
  const months = (spec: Record<string, number | null>) =>
    Object.entries(spec).map(([reportMonth, hours]) => ({
      reportMonth,
      hours,
      note: null,
    }));

  const twelve = (perMonth: number) => {
    const out: Record<string, number> = {};
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(2025, 8 + i, 1));
      out[
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
      ] = perMonth;
    }
    return out;
  };

  const person = (over: Record<string, unknown> = {}) => ({
    publisherId: 'p1',
    displayName: 'Сидоров Александр',
    pioneerSince: null,
    months: [],
    ...over,
  });

  it('counts the whole service year, September to August', () => {
    const review = reviewPioneerYear(2026, '2026-09-05', [
      person({ months: months(twelve(50)) }),
    ]);

    const row = review.rows[0];
    expect(row.hours).toBe(600);
    expect(row.toGoal).toBe(0);
    expect(row.toMinimum).toBe(0);
    expect(row.short).toBe(false);
    expect(review.firstMonth).toBe('2025-09-01');
    expect(review.lastMonth).toBe('2026-08-01');
  });

  it('ignores months outside the year', () => {
    // August 2025 belongs to the PREVIOUS service year; counting it would let
    // a man appear to have made the goal on somebody else's hours.
    const review = reviewPioneerYear(2026, '2026-09-05', [
      person({ months: months({ ...twelve(45), '2025-08-01': 90 }) }),
    ]);

    expect(review.rows[0].hours).toBe(540);
  });

  it('marks a man below the minimum, not merely below the goal', () => {
    // 570 misses the year's goal and still allows him to carry on. Colouring
    // that red would send the committee to a man who needs nothing.
    const review = reviewPioneerYear(2026, '2026-09-05', [
      person({
        publisherId: 'ok',
        displayName: 'Б',
        months: months(twelve(47.5)),
      }),
    ]);

    const row = review.rows[0];
    expect(row.hours).toBe(570);
    expect(row.toGoal).toBe(PIONEER_YEAR_GOAL - 570);
    expect(row.toMinimum).toBe(0);
    expect(row.short).toBe(false);
  });

  it('puts those below the minimum first, furthest below at the top', () => {
    const review = reviewPioneerYear(2026, '2026-09-05', [
      person({
        publisherId: 'fine',
        displayName: 'Аскеров',
        months: months(twelve(50)),
      }),
      person({
        publisherId: 'low',
        displayName: 'Яковлев',
        months: months(twelve(40)),
      }),
      person({
        publisherId: 'lower',
        displayName: 'Борисов',
        months: months(twelve(30)),
      }),
    ]);

    expect(review.rows.map((r) => r.publisherId)).toEqual([
      'lower',
      'low',
      'fine',
    ]);
    expect(review.rows[0].toMinimum).toBe(PIONEER_YEAR_MINIMUM - 360);
  });

  it('gives the pace, which the total hides', () => {
    // Half the year at 60 is not the same story as the whole year at 30, and
    // the totals are identical.
    const review = reviewPioneerYear(2026, '2026-03-10', [
      person({
        months: months({
          '2025-09-01': 60,
          '2025-10-01': 60,
          '2025-11-01': 60,
          '2025-12-01': 60,
          '2026-01-01': 60,
          '2026-02-01': 60,
        }),
      }),
    ]);

    expect(review.rows[0].pace).toBe(60);
    expect(review.rows[0].monthsReported).toBe(6);
  });

  it('does not let an empty month flatter the pace', () => {
    const review = reviewPioneerYear(2026, '2026-01-10', [
      person({
        months: months({
          '2025-09-01': 50,
          '2025-10-01': 50,
          '2025-11-01': 0,
          '2025-12-01': null,
        }),
      }),
    ]);

    expect(review.rows[0].hours).toBe(100);
    expect(review.rows[0].monthsReported).toBe(2);
    expect(review.rows[0].pace).toBe(50);
  });

  it('sets no target for somebody who started pioneering mid-year', () => {
    // He was not a pioneer for twelve months. Measuring him against 600 would
    // report a shortfall he could not have avoided.
    const review = reviewPioneerYear(2026, '2026-08-20', [
      person({
        pioneerSince: '2026-03-01',
        months: months({
          '2026-03-01': 50,
          '2026-04-01': 55,
          '2026-05-01': 50,
        }),
      }),
    ]);

    const row = review.rows[0];
    expect(row.startedMidYear).toBe(true);
    expect(row.toGoal).toBeNull();
    expect(row.toMinimum).toBeNull();
    expect(row.short).toBe(false);
    expect(row.hours).toBe(155);
    expect(row.pace).toBe(51.7);
  });

  it('says which month is still being collected', () => {
    // "Учтено 11 месяцев из 12, август ещё собирается" — without it, the whole
    // list looks behind on 20 August.
    const review = reviewPioneerYear(2026, '2026-08-20', []);

    expect(review.monthsElapsed).toBe(11);
    expect(review.collectingMonth).toBe('2026-08-01');
  });

  it('says nothing is being collected once the year is over', () => {
    const review = reviewPioneerYear(2026, '2026-09-05', []);

    expect(review.monthsElapsed).toBe(12);
    expect(review.collectingMonth).toBeNull();
  });

  it('carries the notes, because that is where credit hours are written', () => {
    // We do not model credit; a pioneer writes it in his own note and the
    // brothers read it. So the notes have to travel with the numbers.
    const review = reviewPioneerYear(2026, '2026-08-20', [
      person({
        months: [
          {
            reportMonth: '2026-01-01',
            hours: 20,
            note: 'болел, лежал в больнице',
          },
          { reportMonth: '2026-02-01', hours: 50, note: '   ' },
          { reportMonth: '2026-03-01', hours: 50, note: null },
        ],
      }),
    ]);

    expect(review.rows[0].notes).toEqual([
      { reportMonth: '2026-01-01', note: 'болел, лежал в больнице' },
    ]);
  });
});

import {
  reviewPioneerYear,
  pioneerReviewDefaults,
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

  it('measures somebody who started mid-year pro rata to his months', () => {
    // 28 September, Lionel: «если он служит не с начала служебного года, а
    // позже, время считается пропорционально месяцам». Until then he had no
    // measure at all; against 600 he would have been accused of the months
    // before his appointment.
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
    expect(row.hours).toBe(155);
    expect(row.pace).toBe(51.7);
    // March–July are over: 5 of his months → 560 × 5/12 ≈ 233, 50 × 5 = 250.
    expect(row.countedMonths).toBe(5);
    expect(row.expectedMinimum).toBe(233);
    expect(row.expectedGoal).toBe(250);
    expect(row.toMinimum).toBe(78);
    // June and July have no report: not final yet.
    expect(row.short).toBe(false);
    expect(row.shortSoFar).toBe(true);
    // His year is March–August: 280, and August is still his to serve.
    expect(row.yearMinimum).toBe(280);
    expect(row.yearLeftToMinimum).toBe(125);
    expect(row.perMonthToMinimum).toBe(125);
  });

  it('a pioneer from March, all reports in, below his own measure', () => {
    const review = reviewPioneerYear(2026, '2026-09-10', [
      person({
        pioneerSince: '2026-03-01',
        months: months({
          '2026-03-01': 40,
          '2026-04-01': 40,
          '2026-05-01': 40,
          '2026-06-01': 40,
          '2026-07-01': 40,
          '2026-08-01': 40,
        }),
      }),
    ]);
    const row = review.rows[0];
    // 6 months: 280 needed, 240 done — final, and pro rata.
    expect(row.expectedMinimum).toBe(280);
    expect(row.toMinimum).toBe(40);
    expect(row.short).toBe(true);
    expect(row.yearLeftToMinimum).toBeNull();
  });

  it('не обвиняет того, чей отчёт ещё не сдан', async () => {
    /**
     * Обзор читают с 20 августа по 20 сентября, и в эти недели август
     * досдают. Месяц без отчёта был неотличим от месяца с нулём: человек,
     * отслуживший год, выглядел недобравшим полсотни часов — ровно тогда,
     * когда по этой цифре решают, продолжать ли ему пионерское служение.
     */
    const withoutAugust = { ...twelve(50) };
    delete withoutAugust['2026-08-01'];

    const review = reviewPioneerYear(2026, '2026-09-10', [
      person({ months: months(withoutAugust) }),
    ]);
    const row = review.rows[0];

    expect(row.hours).toBe(550);
    expect(row.missingMonths).toEqual(['2026-08-01']);
    // Окончательного обвинения нет: год ещё не собран.
    expect(row.short).toBe(false);
    // Но и молчать нельзя — пока не хватает, и это сказано отдельным словом.
    expect(row.shortSoFar).toBe(true);
  });

  it('обвиняет, только когда год собран целиком', () => {
    const review = reviewPioneerYear(2026, '2026-09-10', [
      person({ months: months(twelve(45)) }),
    ]);
    const row = review.rows[0];

    expect(row.hours).toBe(540);
    expect(row.missingMonths).toEqual([]);
    expect(row.short).toBe(true);
    expect(row.shortSoFar).toBe(false);
  });

  it('не считает недостающим месяц, который ещё идёт', () => {
    // Сентябрь сдают в октябре: требовать его сейчас — требовать невозможного.
    const review = reviewPioneerYear(2027, '2026-09-10', [
      person({ months: [] }),
    ]);

    expect(review.rows[0].missingMonths).toEqual([]);
  });

  it('не требует месяцев до того, как он стал пионером', () => {
    // Он не был пионером в сентябре — и отчёта пионера за сентябрь быть не
    // может. Прежде такие месяцы попадали бы в недостающие все разом.
    const review = reviewPioneerYear(2026, '2026-09-10', [
      person({
        pioneerSince: '2026-03-01',
        months: months({ '2026-03-01': 50, '2026-04-01': 50 }),
      }),
    ]);

    expect(review.rows[0].missingMonths).toEqual([
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
    ]);
  });

  it('ставит первыми тех, про кого уже всё известно', () => {
    /**
     * Сперва год собран и порог не взят — тут разговор о служении. За ними
     * те, кому не хватает по сданному: с ними сперва разговор об отчёте.
     */
    const withoutAugust = { ...twelve(40) };
    delete withoutAugust['2026-08-01'];

    const review = reviewPioneerYear(2026, '2026-09-10', [
      person({
        publisherId: 'p-incomplete',
        displayName: 'Б',
        months: months(withoutAugust),
      }),
      person({
        publisherId: 'p-final',
        displayName: 'А',
        months: months(twelve(45)),
      }),
    ]);

    expect(review.rows.map((r) => r.publisherId)).toEqual([
      'p-final',
      'p-incomplete',
    ]);
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

  it('puts the notes in the order the service year runs', () => {
    // The year starts in September, so September comes FIRST. Left in database
    // order the card read «июнь, июль, сентябрь», which looks like an error.
    const review = reviewPioneerYear(2026, '2026-08-20', [
      person({
        months: [
          { reportMonth: '2026-06-01', hours: 50, note: 'июнь' },
          { reportMonth: '2025-09-01', hours: 50, note: 'сентябрь' },
          { reportMonth: '2026-01-01', hours: 50, note: 'январь' },
        ],
      }),
    ]);

    expect(review.rows[0].notes.map((n) => n.note)).toEqual([
      'сентябрь',
      'январь',
      'июнь',
    ]);
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

  describe('the review in the middle of the year (28 September)', () => {
    const half = (spec: Record<string, number | null>) =>
      months(spec).slice(0, 6);

    it('looks at September to February and measures by the months counted', () => {
      // 10 March: all six months are in. 6 × 50 = 300, 560 × 6/12 = 280.
      const review = reviewPioneerYear(
        2026,
        '2026-03-10',
        [person({ months: half(twelve(45)) })],
        { through: '2026-02-01' },
      );
      expect(review.window).toBe('part');
      expect(review.windowMonths).toBe(6);
      expect(review.monthsElapsed).toBe(6);
      expect(review.windowComplete).toBe(true);
      expect(review.expectedGoal).toBe(300);
      expect(review.expectedMinimum).toBe(280);
      const row = review.rows[0];
      expect(row.hours).toBe(270);
      expect(row.toMinimum).toBe(10);
      expect(row.short).toBe(true);
      // The talk in March: 290 left to 560, six months to go — 49 a month.
      expect(row.yearLeftToMinimum).toBe(290);
      expect(row.perMonthToMinimum).toBe(49);
    });

    it('does not accuse anybody in the middle of the year by the whole year', () => {
      // Before: 300 hours against 560 read as «не хватает 260» for everybody.
      const review = reviewPioneerYear(
        2026,
        '2026-03-10',
        [person({ months: half(twelve(50)) })],
        { through: '2026-02-01' },
      );
      expect(review.rows[0].short).toBe(false);
      expect(review.rows[0].shortSoFar).toBe(false);
      expect(review.rows[0].toMinimum).toBe(0);
    });

    it('leaves out whoever was not a pioneer in any month of it', () => {
      const review = reviewPioneerYear(
        2026,
        '2026-03-10',
        [person({ pioneerSince: '2026-03-01', months: [] })],
        { through: '2026-02-01' },
      );
      expect(review.rows).toEqual([]);
    });

    it('says February is still being handed in, and does not require it', () => {
      const review = reviewPioneerYear(
        2026,
        '2026-02-20',
        [person({ months: half(twelve(50)).slice(0, 5) })],
        { through: '2026-02-01' },
      );
      expect(review.monthsElapsed).toBe(5);
      expect(review.windowComplete).toBe(false);
      expect(review.collectingMonth).toBe('2026-02-01');
      expect(review.rows[0].missingMonths).toEqual([]);
      expect(review.rows[0].months.map((m) => m.state).slice(4)).toEqual([
        'reported',
        'collecting',
      ]);
    });
  });

  it('does not ask for months after his pioneering ended', () => {
    // Stopped in December: until 28 September January–August were «missing»
    // and he was measured against 600.
    const review = reviewPioneerYear(2026, '2026-09-10', [
      person({
        spans: [{ start: '2019-09-01', end: '2025-12-01' }],
        months: months({
          '2025-09-01': 50,
          '2025-10-01': 50,
          '2025-11-01': 50,
          '2025-12-01': 50,
          '2026-01-01': 10,
        }),
      }),
    ]);
    const row = review.rows[0];
    expect(row.endedIn).toBe('2025-12-01');
    expect(row.missingMonths).toEqual([]);
    // Pro rata to his four months: 560 × 4/12 ≈ 187 — met.
    expect(row.countedMonths).toBe(4);
    expect(row.expectedMinimum).toBe(187);
    expect(row.toMinimum).toBe(0);
    expect(row.short).toBe(false);
    expect(row.yearLeftToMinimum).toBeNull();
    // January was a publisher's report, not a pioneer's.
    expect(row.hours).toBe(200);
    expect(row.months[4].state).toBe('notPioneer');
  });

  it('tells a report with no hours from no report at all', () => {
    const review = reviewPioneerYear(2026, '2026-01-10', [
      person({
        months: [
          { reportMonth: '2025-09-01', hours: 50, bibleStudies: 2, note: null },
          { reportMonth: '2025-10-01', hours: 0, note: 'болел' },
        ],
      }),
    ]);
    const lines = review.rows[0].months;
    expect(lines.slice(0, 4).map((l) => l.state)).toEqual([
      'reported',
      'zero',
      'missing',
      'missing',
    ]);
    expect(lines[0].bibleStudies).toBe(2);
    expect(lines[1].note).toBe('болел');
    expect(lines[4].state).toBe('collecting');
    expect(lines[5].state).toBe('upcoming');
    expect(review.rows[0].missingMonths).toEqual(['2025-11-01', '2025-12-01']);
  });

  describe('what opens without a year in the link', () => {
    it('the ended year until the 20th of October', () => {
      expect(pioneerReviewDefaults('2026-09-28')).toEqual({
        serviceYear: 2026,
        window: 'year',
      });
      expect(pioneerReviewDefaults('2026-10-20').serviceYear).toBe(2026);
      expect(pioneerReviewDefaults('2026-10-21').serviceYear).toBe(2027);
    });

    it('September to February from February to April', () => {
      expect(pioneerReviewDefaults('2027-02-15')).toEqual({
        serviceYear: 2027,
        window: 'half',
      });
      expect(pioneerReviewDefaults('2027-05-01').window).toBe('year');
    });

    it('what the link asks for, when it asks', () => {
      expect(pioneerReviewDefaults('2027-02-15', 2026, 'year')).toEqual({
        serviceYear: 2026,
        window: 'year',
      });
    });
  });
});

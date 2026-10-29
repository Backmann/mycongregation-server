import {
  auxiliaryPioneerHourGoal,
  goalOf,
  reducedReasons,
  monthsInRange,
  isActiveInMonth,
  AUX_PIONEER_REDUCED_HOURS,
  AUX_PIONEER_STANDARD_HOURS,
} from './auxiliary-pioneer-hours';

describe('auxiliary pioneer hour goal', () => {
  it('March and April are always reduced (15h) with no events', () => {
    expect(auxiliaryPioneerHourGoal('2026-03', [])).toBe(
      AUX_PIONEER_REDUCED_HOURS,
    );
    expect(auxiliaryPioneerHourGoal('2026-04', [])).toBe(
      AUX_PIONEER_REDUCED_HOURS,
    );
  });

  it('an ordinary month with no events is standard (30h)', () => {
    expect(auxiliaryPioneerHourGoal('2026-07', [])).toBe(
      AUX_PIONEER_STANDARD_HOURS,
    );
  });

  it('the Memorial month is reduced', () => {
    const events = [{ type: 'memorial', date: '2026-04-02', endDate: null }];
    // April is already reduced, so test the Memorial in a non-spring month too.
    expect(auxiliaryPioneerHourGoal('2026-04', events)).toBe(15);
    const may = [{ type: 'memorial', date: '2026-05-01', endDate: null }];
    expect(auxiliaryPioneerHourGoal('2026-05', may)).toBe(15);
  });

  it('a circuit-overseer visit reduces its month', () => {
    const events = [
      {
        type: 'circuit_overseer_visit',
        date: '2026-09-15',
        endDate: '2026-09-20',
      },
    ];
    expect(auxiliaryPioneerHourGoal('2026-09', events)).toBe(15);
    expect(auxiliaryPioneerHourGoal('2026-10', events)).toBe(30);
  });

  it('a visit spanning a month boundary reduces BOTH months', () => {
    // Visit week runs Sep 29 – Oct 4.
    const events = [
      {
        type: 'circuit_overseer_visit',
        date: '2026-09-29',
        endDate: '2026-10-04',
      },
    ];
    expect(auxiliaryPioneerHourGoal('2026-09', events)).toBe(15);
    expect(auxiliaryPioneerHourGoal('2026-10', events)).toBe(15);
    expect(auxiliaryPioneerHourGoal('2026-11', events)).toBe(30);
  });
});

describe('reducedReasons — why a month allows 15 hours (29 October 2026)', () => {
  it('names every reason, and none for an ordinary month', () => {
    const ev = [
      { type: 'memorial', date: '2027-03-22', endDate: null },
      {
        type: 'circuit_overseer_visit',
        date: '2027-01-19',
        endDate: '2027-01-24',
      },
    ];
    expect(reducedReasons('2027-03', ev).sort()).toEqual([
      'march_april',
      'memorial',
    ]);
    expect(reducedReasons('2027-01', ev)).toEqual(['co_visit']);
    expect(reducedReasons('2027-02', ev)).toEqual([]);
  });

  it('a campaign counts only when it says so', () => {
    const on = [
      {
        type: 'campaign',
        date: '2027-06-15',
        endDate: '2027-07-15',
        auxReducedHours: true,
      },
    ];
    const off = [
      {
        type: 'campaign',
        date: '2027-06-15',
        endDate: '2027-07-15',
        auxReducedHours: false,
      },
    ];
    expect(reducedReasons('2027-06', on)).toEqual(['campaign']);
    expect(reducedReasons('2027-07', on)).toEqual(['campaign']);
    expect(reducedReasons('2027-06', off)).toEqual([]);
  });

  it("the goal of a month is the person's own", () => {
    expect(goalOf({ reducedMonths: ['2027-03'] }, '2027-03')).toBe(15);
    expect(goalOf({ reducedMonths: ['2027-03'] }, '2027-04')).toBe(30);
    expect(goalOf({ reducedMonths: [] }, '2027-03')).toBe(30);
  });

  it('a range longer than two years is not cut short', () => {
    expect(monthsInRange('2024-01-01', '2026-12-01')).toHaveLength(36);
  });
});

describe('monthsInRange', () => {
  it('single day → one month', () => {
    expect(monthsInRange('2026-05-10', null)).toEqual(['2026-05']);
  });
  it('range crossing a boundary → both months', () => {
    expect(monthsInRange('2026-09-29', '2026-10-04')).toEqual([
      '2026-09',
      '2026-10',
    ]);
  });
  it('multi-month range', () => {
    expect(monthsInRange('2026-03-01', '2026-05-31')).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
  });
});

describe('isActiveInMonth', () => {
  const fixed = {
    startMonth: '2026-03-01',
    endMonth: '2026-05-01',
    untilCancelled: false,
  };
  it('inside a fixed range', () => {
    expect(isActiveInMonth(fixed, '2026-04')).toBe(true);
    expect(isActiveInMonth(fixed, '2026-03')).toBe(true);
    expect(isActiveInMonth(fixed, '2026-05')).toBe(true);
  });
  it('outside a fixed range', () => {
    expect(isActiveInMonth(fixed, '2026-02')).toBe(false);
    expect(isActiveInMonth(fixed, '2026-06')).toBe(false);
  });
  it('until-cancelled is active from start onward', () => {
    const openEnded = {
      startMonth: '2026-03-01',
      endMonth: null,
      untilCancelled: true,
    };
    expect(isActiveInMonth(openEnded, '2026-03')).toBe(true);
    expect(isActiveInMonth(openEnded, '2027-12')).toBe(true);
    expect(isActiveInMonth(openEnded, '2026-02')).toBe(false);
  });
});

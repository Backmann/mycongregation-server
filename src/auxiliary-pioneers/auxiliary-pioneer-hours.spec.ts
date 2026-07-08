import {
  auxiliaryPioneerHourGoal,
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
    const events = [{ date: '2026-04-02', endDate: null }];
    // April is already reduced, so test the Memorial in a non-spring month too.
    expect(auxiliaryPioneerHourGoal('2026-04', events)).toBe(15);
    const may = [{ date: '2026-05-01', endDate: null }];
    expect(auxiliaryPioneerHourGoal('2026-05', may)).toBe(15);
  });

  it('a circuit-overseer visit reduces its month', () => {
    const events = [{ date: '2026-09-15', endDate: '2026-09-20' }];
    expect(auxiliaryPioneerHourGoal('2026-09', events)).toBe(15);
    expect(auxiliaryPioneerHourGoal('2026-10', events)).toBe(30);
  });

  it('a visit spanning a month boundary reduces BOTH months', () => {
    // Visit week runs Sep 29 – Oct 4.
    const events = [{ date: '2026-09-29', endDate: '2026-10-04' }];
    expect(auxiliaryPioneerHourGoal('2026-09', events)).toBe(15);
    expect(auxiliaryPioneerHourGoal('2026-10', events)).toBe(15);
    expect(auxiliaryPioneerHourGoal('2026-11', events)).toBe(30);
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

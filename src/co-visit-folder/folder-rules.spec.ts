import {
  FOLDER_ITEMS,
  answerAllowed,
  dueOn,
  eraseOn,
  gapsRemindOn,
  isReady,
  monthBefore,
  s62DueOn,
  s62RemindOn,
} from './folder-rules';

describe('the S-61 folder rules', () => {
  it('has the form’s 14 items on page 1 plus the committee’s two', () => {
    const byRole = (r: string) =>
      FOLDER_ITEMS.filter((i) => i.role === r).length;
    expect(FOLDER_ITEMS).toHaveLength(16);
    expect(byRole('coordinator')).toBe(5);
    expect(byRole('secretary')).toBe(5);
    expect(byRole('service_overseer')).toBe(6);
    expect(FOLDER_ITEMS.filter((i) => i.extra).map((i) => i.key)).toEqual([
      '3.5',
      '3.6',
    ]);
  });

  it('is due on the Tuesday of the visit week', () => {
    expect(dueOn('2027-02-23')).toBe('2027-02-23'); // Tuesday
    expect(dueOn('2027-02-22')).toBe('2027-02-23'); // Monday
    expect(dueOn('2027-02-28')).toBe('2027-02-23'); // Sunday
    expect(dueOn('2026-08-04')).toBe('2026-08-04');
  });

  it('wants the S-62 a month before, reminded a month before that', () => {
    expect(s62DueOn('2027-02-23')).toBe('2027-01-23');
    expect(s62RemindOn('2027-02-23')).toBe('2026-12-23');
    expect(gapsRemindOn('2027-02-23')).toBe('2027-02-16');
    expect(monthBefore('2027-03-31')).toBe('2027-02-28');
  });

  it('erases page 2 the day after the visit', () => {
    expect(eraseOn('2027-02-23', '2027-02-28')).toBe('2027-03-01');
    expect(eraseOn('2027-02-23', null)).toBe('2027-02-24');
  });

  it('gives questions 1, 2, 10 and 12 only yes and no', () => {
    for (const q of [1, 2, 10, 12]) {
      expect(answerAllowed(q, 'na')).toBe(false);
      expect(answerAllowed(q, 'yes')).toBe(true);
    }
    expect(answerAllowed(4, 'na')).toBe(true);
    expect(answerAllowed(0, 'yes')).toBe(false);
    expect(answerAllowed(16, 'yes')).toBe(false);
    expect(answerAllowed(3, 'maybe')).toBe(false);
  });

  it('counts a saved file as ready only while it matches its data', () => {
    expect(isReady('saved', false)).toBe(true);
    expect(isReady('saved', true)).toBe(false);
    expect(isReady('paper', true)).toBe(true);
    expect(isReady(null, false)).toBe(false);
  });
});

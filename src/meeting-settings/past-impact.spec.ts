import { pastImpact, type ScheduleFields } from './past-impact';

const v = (over: Partial<ScheduleFields> = {}): ScheduleFields => ({
  effectiveFrom: '2026-01-05',
  midweekDow: 3,
  midweekTime: '19:00',
  weekendDow: 7,
  weekendTime: '13:00',
  address: 'Hall',
  microphoneSlots: 2,
  ...over,
});
// Saturday 26 September 2026: the weeks of 7, 14 and 21 September have begun,
// and so has the week of 21 September.
const today = '2026-09-26';

describe('pastImpact — a schedule version dated in the past', () => {
  it('a version from today or later touches nothing that has begun', () => {
    const r = pastImpact({
      existing: [v()],
      candidate: v({ effectiveFrom: '2026-09-28', midweekDow: 4 }),
      today,
      attendance: [],
    });
    expect(r.weeks).toBe(0);
    // Dated on a Wednesday of this week: takes effect next Monday, as week-rules reads it.
    expect(
      pastImpact({
        existing: [v()],
        candidate: v({ effectiveFrom: '2026-09-23', midweekTime: '19:30' }),
        today,
        attendance: [],
      }).weeks,
    ).toBe(0);
  });

  it('counts the begun weeks and names what changes', () => {
    const r = pastImpact({
      existing: [v()],
      candidate: v({ effectiveFrom: '2026-09-07', midweekTime: '19:30' }),
      today,
      attendance: [],
    });
    expect(r.weeks).toBe(3);
    expect([r.from, r.to]).toEqual(['2026-09-07', '2026-09-21']);
    expect(r.changes).toEqual([
      { field: 'midweekTime', was: '19:00', becomes: '19:30' },
    ]);
    expect(r.attendanceOnMovedDays).toBe(0);
  });

  it('counts attendance left on the old weekday when the day moves', () => {
    const r = pastImpact({
      existing: [v()],
      candidate: v({ effectiveFrom: '2026-09-14', midweekDow: 4 }),
      today,
      attendance: [
        { date: '2026-09-09', eventType: 'midweek' }, // before the change — untouched
        { date: '2026-09-16', eventType: 'midweek' }, // Wednesday: left behind
        { date: '2026-09-23', eventType: 'midweek' }, // Wednesday: left behind
        { date: '2026-09-20', eventType: 'weekend' }, // weekend did not move
        { date: '2026-09-22', eventType: 'midweek' }, // a Tuesday (a visit): not on the old day
      ],
    });
    expect(r.weeks).toBe(2);
    expect(r.attendanceOnMovedDays).toBe(2);
    expect(r.changes).toEqual([
      { field: 'midweekDow', was: '3', becomes: '4' },
    ]);
  });

  it('correcting the version in force with its own date is seen as a change of that version', () => {
    const r = pastImpact({
      existing: [v({ effectiveFrom: '2026-09-07' })],
      candidate: v({ effectiveFrom: '2026-09-07', address: 'New hall' }),
      today,
      attendance: [],
    });
    expect(r.weeks).toBe(3);
    expect(r.changes).toEqual([
      { field: 'address', was: 'Hall', becomes: 'New hall' },
    ]);
  });

  it('a later version already in force limits the change to the weeks before it', () => {
    const r = pastImpact({
      existing: [v(), v({ effectiveFrom: '2026-09-14', midweekTime: '18:30' })],
      candidate: v({ effectiveFrom: '2026-09-07', midweekTime: '19:30' }),
      today,
      attendance: [],
    });
    expect([r.weeks, r.from, r.to]).toEqual([1, '2026-09-07', '2026-09-07']);
  });

  it('saving the same values again changes nothing', () => {
    const r = pastImpact({
      existing: [v()],
      candidate: v(),
      today,
      attendance: [],
    });
    expect(r.weeks).toBe(0);
  });
});
